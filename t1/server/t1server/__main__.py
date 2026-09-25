"""python -m t1server <command>

  serve            run the server (0.0.0.0:8095, mDNS advert)
  build            build all filters now, in the foreground, and print the log
  pubkey-header    print firmware pubkey.h (the build script writes it into the sketch)
  device-token     print the device token (the build script writes it into secrets.h)
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
    elif cmd in ("device-token", "admin-token"):
        from .config import tokens
        print(tokens()[cmd.replace("-", "_")])
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
