#!/usr/bin/env bash
# Read-only: commits per day (all branches, by author date) for the activity-log days.
cd /e/Gateflame || exit 1
for d in 08-25 08-28 08-29 08-30 08-31 09-06 09-09 09-10 09-11 09-12 09-13 09-15 09-16 09-19 09-20 09-21 09-22 09-23 09-24 09-25 09-26 09-27 09-28; do
  n=$(git log --all --format='%ad' --date=format:%m-%d | grep -c "^$d$")
  printf '%s %3s\n' "$d" "$n"
done
