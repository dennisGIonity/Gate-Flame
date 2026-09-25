import os
import sys
import tempfile
from pathlib import Path

# Every test run gets its own data dir: no keys, tokens or filters from the real server.
os.environ["T1_DATA_DIR"] = tempfile.mkdtemp(prefix="t1test-")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
