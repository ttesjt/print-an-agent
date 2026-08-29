import json
import sys
import time


request = json.load(sys.stdin)
fixture = request["input"]

print(json.dumps({"kind": "progress", "progress": {"phase": "initializing"}}), flush=True)
time.sleep(fixture.get("delaySeconds", 0))
print(
    json.dumps(
        {
            "kind": "terminal",
            "terminal": {
                "status": "succeeded",
                "result": fixture["result"],
            },
        }
    ),
    flush=True,
)
