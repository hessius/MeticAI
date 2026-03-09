"""Machine discovery service for auto-detecting Meticulous espresso machines.

Implements a multi-tier discovery strategy:
1. mDNS/Zeroconf browse for _meticulous._tcp.local.
2. Hostname resolution for meticulous.local
3. If no machine is found, return guidance for manual configuration.

Discovery typically completes within several seconds under normal conditions.
"""

import asyncio
import socket
from dataclasses import dataclass
from typing import Optional

from logging_config import get_logger

logger = get_logger()

# Overall discovery timeout
DISCOVERY_TIMEOUT_SECONDS = 10

# mDNS service type advertised by Meticulous machines
MDNS_SERVICE_TYPE = "_meticulous._tcp.local."


@dataclass
class DiscoveryResult:
    """Result of machine discovery."""
    found: bool
    ip: Optional[str] = None
    hostname: Optional[str] = None
    method: Optional[str] = None
    guidance: Optional[str] = None


async def discover_machine() -> DiscoveryResult:
    """
    Attempt to discover a Meticulous machine on the local network.
    
    Tries multiple discovery methods in order:
    1. mDNS/Zeroconf service discovery
    2. Direct hostname resolution (meticulous.local)
    3. Guidance for manual configuration
    
    Returns:
        DiscoveryResult with found=True if machine discovered, or
        found=False with guidance on how to configure manually.
    """
    # Try mDNS service discovery first
    result = await _try_mdns_discovery()
    if result.found:
        return result
    
    # Fallback to direct hostname resolution
    result = await _try_hostname_resolution()
    if result.found:
        return result
    
    # No machine found - provide guidance
    logger.info("Machine discovery: no machine found via mDNS or hostname")
    return DiscoveryResult(
        found=False,
        guidance=(
            "Could not automatically detect your Meticulous machine. "
            "Please ensure:\n"
            "• Your machine is powered on and connected to WiFi\n"
            "• Your device is on the same network as the machine\n"
            "• Try entering the IP address manually (check your router's DHCP leases)"
        )
    )


async def _try_mdns_discovery() -> DiscoveryResult:
    """
    Attempt mDNS/Zeroconf service discovery.
    
    Browses for _meticulous._tcp.local. services.
    """
    try:
        from zeroconf import Zeroconf, ServiceBrowser
        from zeroconf.asyncio import AsyncZeroconf
        
        discovered: list[tuple[str, str]] = []  # (ip, hostname) pairs
        
        class Listener:
            def add_service(self, zc: Zeroconf, service_type: str, name: str) -> None:
                info = zc.get_service_info(service_type, name)
                if info and info.addresses:
                    ip = socket.inet_ntoa(info.addresses[0])
                    hostname = info.server.rstrip('.')
                    discovered.append((ip, hostname))
                    logger.info(f"mDNS discovery found: {hostname} at {ip}")
            
            def remove_service(self, zc: Zeroconf, service_type: str, name: str) -> None:
                pass
            
            def update_service(self, zc: Zeroconf, service_type: str, name: str) -> None:
                pass
        
        azc = AsyncZeroconf()
        try:
            listener = Listener()
            browser = ServiceBrowser(azc.zeroconf, MDNS_SERVICE_TYPE, listener)
            
            # Wait for discovery with timeout
            await asyncio.sleep(min(3, DISCOVERY_TIMEOUT_SECONDS))
            browser.cancel()
            
            if discovered:
                ip, hostname = discovered[0]
                return DiscoveryResult(
                    found=True,
                    ip=ip,
                    hostname=hostname,
                    method="mdns"
                )
        finally:
            await azc.async_close()
            
    except ImportError:
        logger.warning("zeroconf package not available for mDNS discovery")
    except Exception as e:
        logger.warning(f"mDNS discovery failed: {e}")
    
    return DiscoveryResult(found=False)


async def _try_hostname_resolution() -> DiscoveryResult:
    """
    Attempt to resolve meticulous.local hostname.
    
    This works when mDNS responder is available on the system.
    """
    try:
        loop = asyncio.get_event_loop()
        
        # Try to resolve meticulous.local
        hostname = "meticulous.local"
        try:
            # Run blocking getaddrinfo in executor
            result = await asyncio.wait_for(
                loop.run_in_executor(
                    None,
                    lambda: socket.getaddrinfo(hostname, 80, socket.AF_INET)
                ),
                timeout=5.0
            )
            if result:
                ip = result[0][4][0]  # Extract IP from first result
                logger.info(f"Hostname resolution found: {hostname} at {ip}")
                return DiscoveryResult(
                    found=True,
                    ip=ip,
                    hostname=hostname,
                    method="hostname"
                )
        except socket.gaierror:
            logger.debug(f"Could not resolve {hostname}")
        except asyncio.TimeoutError:
            logger.debug(f"Hostname resolution timed out for {hostname}")
            
    except Exception as e:
        logger.warning(f"Hostname resolution failed: {e}")
    
    return DiscoveryResult(found=False)


async def verify_machine(ip: str) -> bool:
    """
    Verify that a machine at the given IP is actually responding.
    
    Makes a quick HTTP request to the machine's API.
    """
    import httpx
    
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            # Try to hit the machine's status endpoint
            response = await client.get(f"http://{ip}:8080/api/getLastShotProfileJSON")
            return response.status_code in (200, 404)  # 404 is OK - means API is responding
    except Exception:
        return False
