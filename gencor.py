import socket
import sys
import platform

def get_local_ips():
    """
    Get all local IP addresses of the host (Linux, macOS, Windows compatible).
    """
    ips = set()

    # Get hostname-based IPs
    try:
        host_name = socket.gethostname()
        host_ips = socket.gethostbyname_ex(host_name)[2]
        ips.update(host_ips)
    except Exception as e:
        print(f"Error fetching hostname IPs: {e}", file=sys.stderr)

    # Get default outbound IP (connect trick)
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.add(s.getsockname()[0])
        s.close()
    except Exception as e:
        print(f"Error fetching outbound IP: {e}", file=sys.stderr)

    # Always include localhost
    ips.update(["127.0.0.1"])

    return sorted(ips)


def generate_cors_origins(ports=[4000, 2000, 3000, 5000, 8080]):
    """
    Generate CORS origins for all detected IPs and ports.
    """
    ips = get_local_ips()
    origins = []

    # Include localhost explicitly
    for port in ports:
        origins.append(f"http://localhost:{port}")

    # Add IP-based origins
    for ip in ips:
        for port in ports:
            origins.append(f"http://{ip}:{port}")

    # Add hostname.local (for mDNS, like raspi.local)
    hostname = socket.gethostname().lower()
    for port in ports:
        origins.append(f"http://{hostname}.local:{port}")

    return origins


if __name__ == "__main__":
    origins = generate_cors_origins()
    cors_env = "CORS_ALLOW_ORIGINS=" + ",".join(origins)
    print(cors_env)
