"""Writes N valid-looking encrypted proposals into the vault folder of a container, to see what a full vault costs.

  docker cp scripts/loadtest/fill_vault.py <container>:/tmp/fill_vault.py
  docker exec <container> /app/voice-agent-py/.venv/bin/python /tmp/fill_vault.py 3000
  docker exec <container> /app/voice-agent-py/.venv/bin/python /tmp/fill_vault.py clear
"""

import base64
import json
import os
import random
import sys
import time

VAULT = "/app/voice-agent-py/data/vault"
ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
MARK = ".loadtest-marker"


def b64(n):
    return base64.b64encode(os.urandom(n)).decode()


def main():
    os.makedirs(VAULT, exist_ok=True)
    if sys.argv[1] == "clear":
        n = 0
        for name in os.listdir(VAULT):
            if name.startswith("NXP-ZZ"):  # only the files this script made
                os.remove(os.path.join(VAULT, name))
                n += 1
        print("removed", n)
        return
    count = int(sys.argv[1])
    for _ in range(count):
        pid = "NXP-ZZ" + "".join(random.choice(ALPHABET) for _ in range(6))
        blob = {"v": 1, "id": pid, "salt": b64(16), "iv": b64(12), "ciphertext": b64(1500), "savedAt": int(time.time() * 1000), "step": 2, "authVerifier": os.urandom(32).hex()}
        with open(os.path.join(VAULT, pid + ".json"), "w") as f:
            json.dump(blob, f)
    print("files now", len(os.listdir(VAULT)))


main()
