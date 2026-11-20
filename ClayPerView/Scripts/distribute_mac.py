"""Sign a verified Clay-Per-View Mac release and explicitly submit it to Apple's notary service."""
import argparse
import json
from pathlib import Path
import plistlib
import re
import subprocess
import tempfile

from verify_broadcast import ROOT, archive_sha256, verify_build


def resolve_identity(requested):
    identities = subprocess.check_output(["security", "find-identity", "-v", "-p", "codesigning"], text=True)
    matches = []
    for fingerprint, name in re.findall(r'\b([A-Fa-f0-9]{40})\s+"([^"]+)"', identities):
        if name.startswith("Developer ID Application:") and (requested == name or requested.upper() == fingerprint.upper()):
            matches.append(fingerprint)
    if len(matches) != 1:
        raise ValueError("Select one valid Developer ID Application identity by its full name or certificate fingerprint.")
    return matches[0]


def sign_bundle(app, identity, entitlements_file, timestamp="--timestamp"):
    embedded = subprocess.check_output(["codesign", "-d", "--entitlements", ":-", app], stderr=subprocess.DEVNULL)
    entitlements = plistlib.loads(embedded)
    entitlements.pop("com.apple.security.get-task-allow", None)
    entitlements_file.write_bytes(plistlib.dumps(entitlements))
    info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
    exe = app / "Contents/MacOS" / info["CFBundleExecutable"]
    # Unreal adds search paths leading back to the engine checkout. A distributed app
    # must load its required third-party libraries from the copies inside its own bundle.
    commands = subprocess.check_output(["otool", "-arch", "arm64", "-l", exe], text=True)
    search_paths = re.findall(r"cmd LC_RPATH\s+cmdsize \d+\s+path (.+?) \(offset", commands)
    internal = []
    removals = []
    for path in search_paths:
        target = Path(path.replace("@executable_path", str(exe.parent)).replace("@loader_path", str(exe.parent))).resolve()
        if app in (target, *target.parents):
            internal.append(target)
        else:
            removals += ["-delete_rpath", path]
    required = re.findall(r"cmd LC_LOAD_DYLIB\s+cmdsize \d+\s+name @rpath/(.+?) \(offset", commands)
    for library in required:
        if not any((directory / library).is_file() for directory in internal):
            raise ValueError(f"The public app is missing its bundled library {library}.")
    if removals:
        subprocess.run(["install_name_tool", *removals, exe], check=True)
    sign = ["codesign", "--force", "--sign", identity, "--options", "runtime", timestamp]
    # The staged Unreal app carries loose dylibs. The executable is sealed by signing its enclosing app.
    for lib in sorted(app.rglob("*.dylib")):
        if lib.is_file() and not lib.is_symlink():
            subprocess.run([*sign, lib], check=True)
    subprocess.run([*sign, "--entitlements", entitlements_file, app], check=True)
    subprocess.run(["codesign", "--verify", "--deep", "--strict", app], check=True)


def zip_payload(payload, target):
    subprocess.run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", payload, target], check=True)


def distribute(archive, output, identity, profile):
    if archive == output:
        raise ValueError("Choose a separate output path to preserve the tested input archive.")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="cpv-distribution-", dir=output.parent) as staging:
        workspace = Path(staging)
        exe, _, _ = verify_build(archive, workspace)
        app = exe.parents[2]
        sign_bundle(app, identity, workspace / "entitlements.plist")
        submission = workspace / "submission.zip"
        zip_payload(app, submission)
        result = subprocess.run(["xcrun", "notarytool", "submit", submission, "--keychain-profile", profile,
                                 "--wait", "--output-format", "json"], capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "The notary submission failed.")
        receipt = json.loads(result.stdout)
        if receipt.get("status") != "Accepted":
            raise RuntimeError(f"Apple returned {receipt.get('status')}. Inspect notarytool log for submission {receipt.get('id')}.")
        subprocess.run(["xcrun", "stapler", "staple", app], check=True)
        subprocess.run(["xcrun", "stapler", "validate", app], check=True)
        subprocess.run(["spctl", "--assess", "--type", "execute", app], check=True)
        public_zip = workspace / "sealed.zip"
        zip_payload(app.parent, public_zip)
        checksum = workspace / "sealed.sha256"
        checksum.write_text(f"{archive_sha256(public_zip)}  {output.name}\n")
        public_zip.replace(output)
        checksum.replace(Path(str(output) + ".sha256"))
        print(f"Apple accepted {receipt['id']}. The stapled game and bilingual guide are in {output}.")


if __name__ == "__main__":
    release = ROOT.parent / "Release"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, default=release / "Clay-Per-View-macOS.zip")
    parser.add_argument("--output", type=Path, default=release / "Clay-Per-View-public-macOS.zip")
    parser.add_argument("--identity", required=True, help="Developer ID Application signing identity in your Mac keychain")
    parser.add_argument("--notary-profile", required=True, help="Keychain profile saved with xcrun notarytool store-credentials")
    args = parser.parse_args()
    try:
        distribute(args.archive.resolve(), args.output.resolve(), resolve_identity(args.identity), args.notary_profile)
    except (ValueError, RuntimeError) as error:
        parser.exit(1, f"{error}\n")
