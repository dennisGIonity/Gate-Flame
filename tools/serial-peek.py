"""serial-peek.py <port> [seconds] - read a board's serial log for a while (read-only)."""
import sys, time
import serial
port = sys.argv[1]; secs = float(sys.argv[2]) if len(sys.argv) > 2 else 20
with serial.Serial(port, 115200, timeout=1) as s:
    t0 = time.time()
    while time.time() - t0 < secs:
        line = s.readline().decode("utf-8", "replace").rstrip()
        if line:
            print(line, flush=True)
