#!/usr/bin/env bash
# READ-ONLY verification of the 2026-09-25 consolidation commit.
cd /e/Gateflame || exit 1
echo "--- files in HEAD commit"; git show --stat --format='%h %an <%ae> %s' HEAD | tail -25
echo "--- working tree (excluding ignored)"; git status --porcelain | head; echo "(lines: $(git status --porcelain | wc -l))"
echo "--- secret scan of the commit's added lines"
git show HEAD | grep '^+' | grep -Eic 'sk-ant-|ghp_[A-Za-z0-9]{20}|AIza[0-9A-Za-z_-]{30}|BEGIN [A-Z ]*PRIVATE KEY-----[A-Za-z0-9]|JhC2b6|7QAAAAIAAAAB'
echo "--- chats in tree == exported"; git ls-files docs/archive-finishing-touches/chats | wc -l
echo "--- unpushed across repo"; git log --branches --not --remotes --oneline
