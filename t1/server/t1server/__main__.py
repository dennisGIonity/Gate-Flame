"""python -m t1server <command>

  serve            run the server (0.0.0.0:8095, mDNS advert)
  build            build all filters now, in the foreground, and print the log
  pubkey-header    print firmware pubkey.h (the build script writes it into the sketch)
  enrol-token      print the enrolment token (typed into a board once, at provisioning)
  device-token     the pre-0.2 shared fleet token (refused unless T1_LEGACY_TOKEN=1)
  backup [DIR]     zip the signing key, secrets and database (default: t1/server/backups)
  admin-token      print the admin token (for the dashboard from another machine / MCP over LAN)
"""
from __future__ import annotations

import sys


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "serve"
    if cmd == "serve":
        import uvicorn
        from .app import create_app
        from .config import PORT
        uvicorn.run(create_app(advertise=True), host="0.0.0.0", port=PORT, log_level="info")
    elif cmd == "build":
        from .service import Service
        from .store import Store
        svc = Service(Store())
        svc.build_filters(background=False)
        print("\n".join(svc.build_state["log"]))
        return 1 if svc.build_state["error"] else 0
    elif cmd == "pubkey-header":
        from .signing import firmware_header
        sys.stdout.write(firmware_header())
    elif cmd in ("device-token", "admin-token", "enrol-token"):
        from .config import tokens
        print(tokens()[cmd.replace("-", "_")])
    elif cmd == "backup":
        from .backup import make_backup
        from .config import DATA_DIR
        print(make_backup(sys.argv[2] if len(sys.argv) > 2 else DATA_DIR.parent / "backups"))
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
