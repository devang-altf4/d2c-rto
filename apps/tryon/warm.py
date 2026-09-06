#!/usr/bin/env python3
"""Pre-generate try-on renders before the demo.

    python3 warm.py me.jpg black cobalt

Generation is 30s+ cold. Doing that live, on venue wifi, in front of judges is
a lost pitch. Run this in rehearsal with the EXACT photo you will upload — the
cache key is sha256(colour + photo), so it only hits on the same file.
"""
import base64, json, sys, time, urllib.request

if len(sys.argv) < 3:
    sys.exit("usage: python3 warm.py <photo.jpg> <colour> [colour...]")

photo, colours = sys.argv[1], sys.argv[2:]
b64 = base64.b64encode(open(photo, "rb").read()).decode()
print("\n  photo  %s  (%.0f KB)\n" % (photo, len(b64) * 0.75 / 1024))

for c in colours:
    t = time.time()
    print("  %-10s … " % c, end="", flush=True)
    body = json.dumps({"photo": b64, "colour": c}).encode()
    req = urllib.request.Request("http://127.0.0.1:5174/api/tryon", body,
                                 {"Content-Type": "application/json"})
    try:
        d = json.loads(urllib.request.urlopen(req, timeout=300).read())
        print("%s in %.0fs" % ("cached already" if d.get("cached") else "generated",
                               time.time() - t))
    except urllib.error.HTTPError as e:
        print("FAILED %d — %s" % (e.code, e.read().decode()[:200]))
    except Exception as e:                                        # noqa: BLE001
        print("FAILED — %s" % e)

print("\n  Upload that same file on stage and it is instant.\n")
