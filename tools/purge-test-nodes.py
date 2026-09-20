"""Remove the throwaway nodes my auth tests created.

They were real rows in the real database - leaving them would put two devices
on the dashboard that do not exist, which is exactly the kind of invented data
this project refuses to show.
"""
import sqlite3

DB = r"C:\Users\DGMic\Downloads\GF Files\gateflame-fleet\fleet.db"
TEST = ("GF-TESTONLY", "GF-TESTONLY2", "GF-ROLLOUTTEST")

conn = sqlite3.connect(DB)
for t in ("nodes", "tokens", "samples", "samples_hourly", "node_admin", "notes"):
    try:
        cur = conn.execute(
            f"DELETE FROM {t} WHERE node_id IN ({','.join('?' * len(TEST))})", TEST
        )
        print(f"  {t}: removed {cur.rowcount}")
    except sqlite3.OperationalError as e:
        print(f"  {t}: {e}")
conn.commit()
print()
print("remaining nodes:")
for r in conn.execute("SELECT node_id, agent_version FROM nodes"):
    print("  ", r[0], r[1])
conn.close()
