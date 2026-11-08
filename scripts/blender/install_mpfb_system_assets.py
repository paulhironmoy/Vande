"""Install the MakeHuman CC0 system asset pack into MPFB's user data directory (Blender background mode).

Usage:
  blender -b --factory-startup --python-exit-code 3 \
    --python scripts/blender/install_mpfb_system_assets.py -- <makehuman_system_assets_cc0.zip> <expected-sha256> <out.json>

The script refuses to install unless:
  * the zip's SHA-256 equals the expected value recorded by the caller;
  * every asset in packs/makehuman_system_assets.json declares licence CC0;
  * every text asset (.mhclo/.mhmat/.proxy/.obj) carries the upstream CC0 release header.
It writes a JSON record of what was checked and installed. It changes nothing outside MPFB's user data directory.
"""

import hashlib
import json
import os
import sys
import zipfile

import addon_utils
import bpy


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) != 3:
        raise SystemExit("usage: -- <zip> <expected-sha256> <out.json>")
    return argv


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    zip_path, expected, out_json = args()
    record = {"zip": os.path.basename(zip_path), "blender": bpy.app.version_string,
              "blender_build_hash": bpy.app.build_hash.decode() if isinstance(bpy.app.build_hash, bytes) else bpy.app.build_hash}
    actual = sha256(zip_path)
    record["sha256"] = actual
    if actual != expected:
        raise SystemExit(f"sha256 mismatch: {actual} != {expected}")

    addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)
    from bl_ext.user_default.mpfb.services import LocationService, AssetService  # noqa: E402

    with zipfile.ZipFile(zip_path) as z:
        names = z.namelist()
        pack = json.loads(z.read("packs/makehuman_system_assets.json"))
        non_cc0 = sorted(k for k, v in pack.items() if v.get("license") != "CC0")
        headers_missing = []
        text_assets = 0
        for n in names:
            if n.endswith((".mhclo", ".mhmat", ".proxy", ".obj")):
                text_assets += 1
                head = z.read(n)[:3000].decode("utf-8", "replace")
                if "released as CC0" not in head:
                    headers_missing.append(n)
        record.update({"entries": len(names), "pack_assets": len(pack), "pack_non_cc0": non_cc0,
                       "text_assets_checked": text_assets, "text_assets_without_cc0_header": headers_missing})
        if non_cc0 or headers_missing:
            raise SystemExit("licence check failed: " + json.dumps(record))
        bad = AssetService.check_asset_pack_zip(zip_path)
        record["mpfb_zip_check"] = bad
        if bad is not None:
            raise SystemExit("MPFB rejected the pack structure: " + str(bad))
        data_dir = LocationService.get_user_data()
        record["installed_into"] = data_dir
        z.extractall(data_dir)

    AssetService.update_all_asset_lists()
    installed, modern = AssetService.check_if_modern_makehuman_system_assets_installed()
    record.update({"mpfb_reports_installed": installed, "mpfb_reports_modern": modern})
    with open(out_json, "w") as f:
        json.dump(record, f, indent=2)
    print("INSTALL_RESULT " + json.dumps(record))
    if not (installed and modern):
        raise SystemExit("MPFB does not report the system assets as installed")


main()
