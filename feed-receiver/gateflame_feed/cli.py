"""Operator CLI: issue and revoke node tokens, inspect the fleet, prune.

    python -m gateflame_feed.cli issue-token GF-A7K29QX4 --label "unit 0142"
    python -m gateflame_feed.cli list-tokens GF-A7K29QX4
    python -m gateflame_feed.cli revoke-token nft-1a2b3c4d5e6f
    python -m gateflame_feed.cli list-nodes
    python -m gateflame_feed.cli prune
    python -m gateflame_feed.cli delete-node GF-A7K29QX4

Token issuance is deliberately CLI-only. There is no HTTP route that mints a
node token: provisioning happens at Ionity, on the machine holding the pepper,
by someone with a shell — not over the network by anything that has already
been authenticated by some other credential. One fewer remotely reachable path
to a valid credential.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time

from .config import Config
from .schema import NODE_ID_PATTERN
from .security import hash_token, load_or_create_pepper
from .storage import FeedStore


def _store_and_pepper(cfg: Config) -> tuple[FeedStore, str]:
    return FeedStore(cfg.db_path), load_or_create_pepper(cfg)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="gateflame_feed.cli")
    sub = parser.add_subparsers(dest="command", required=True)

    p_issue = sub.add_parser("issue-token", help="mint a bearer token for one node")
    p_issue.add_argument("node_id")
    p_issue.add_argument("--label", default="")

    p_list_tokens = sub.add_parser("list-tokens")
    p_list_tokens.add_argument("node_id")

    p_revoke = sub.add_parser("revoke-token")
    p_revoke.add_argument("token_id")

    sub.add_parser("list-nodes")
    sub.add_parser("prune")

    p_delete = sub.add_parser("delete-node", help="POPIA erasure: history, tokens, identity")
    p_delete.add_argument("node_id")

    args = parser.parse_args(argv)
    cfg = Config.from_env()

    if args.command == "issue-token":
        if not re.match(NODE_ID_PATTERN, args.node_id):
            print(f"not a valid nodeId (§3.3 shape GF-XXXXXXXX): {args.node_id}", file=sys.stderr)
            return 2
        store, pepper = _store_and_pepper(cfg)
        label = args.label or f"issued {time.strftime('%Y-%m-%d')}"
        token_id, token = store.issue_node_token(args.node_id, label, lambda t: hash_token(t, pepper))
        # Printed once. Only the HMAC reached the database; there is no way to
        # recover this value later, by design — reissue instead.
        print(json.dumps({"tokenId": token_id, "nodeId": args.node_id, "token": token}, indent=2))
        print(
            "\nSet on the appliance:\n"
            f"  GATEFLAME_FEED_TOKEN={token}\n"
            "  GATEFLAME_FEED_ENABLED=true\n"
            "This value is not stored and cannot be shown again.",
            file=sys.stderr,
        )
        return 0

    if args.command == "list-tokens":
        store, _ = _store_and_pepper(cfg)
        print(json.dumps(store.list_node_tokens(args.node_id), indent=2))
        return 0

    if args.command == "revoke-token":
        store, _ = _store_and_pepper(cfg)
        ok = store.revoke_node_token(args.token_id)
        print(json.dumps({"tokenId": args.token_id, "revoked": ok}))
        return 0 if ok else 1

    if args.command == "list-nodes":
        store, _ = _store_and_pepper(cfg)
        print(json.dumps(store.list_nodes(), indent=2))
        return 0

    if args.command == "prune":
        store, _ = _store_and_pepper(cfg)
        removed = store.prune(cfg.retention_days, cfg.max_rows_per_node)
        print(json.dumps({"deletedReports": removed, "retentionDays": cfg.retention_days}))
        return 0

    if args.command == "delete-node":
        store, _ = _store_and_pepper(cfg)
        removed = store.delete_node(args.node_id)
        print(json.dumps({"nodeId": args.node_id, "deletedReports": removed}))
        return 0

    return 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
