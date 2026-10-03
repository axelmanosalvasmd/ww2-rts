"""Reject a second launch when a configured Blender port is already occupied."""
import socket

for port in (9876, 9877, 9878):
    with socket.socket() as probe:
        probe.settimeout(0.2)
        if probe.connect_ex(("127.0.0.1", port)) == 0:
            raise SystemExit(
                f"Port {port} is occupied. Close the existing project Blender "
                "instance before starting another."
            )
