"""Helpers for interacting with the s6-overlay container environment."""

import logging
import os

logger = logging.getLogger(__name__)


def update_s6_env(var_name: str, value: str, request_id: str = "") -> None:
    """Write an environment variable to the s6 container environment directory.

    s6-overlay services started with ``#!/command/with-contenv sh`` read their
    environment from ``/var/run/s6/container_environment/``.  Updating a file
    there ensures that the *next* service restart picks up the new value —
    something that ``os.environ[…]`` alone cannot achieve because the FastAPI
    process is separate from the s6 supervision tree.

    Silently skips when not running inside s6-overlay.
    """
    s6_env_dir = "/var/run/s6/container_environment"
    if not os.path.isdir(s6_env_dir):
        logger.debug(
            "s6 container environment dir not found (%s) — probably not running "
            "inside s6-overlay; skipping",
            s6_env_dir,
            extra={"request_id": request_id},
        )
        return
    try:
        env_file = os.path.join(s6_env_dir, var_name)
        with open(env_file, "w") as f:
            f.write(value)
        logger.info(
            "Updated s6 container env %s",
            var_name,
            extra={"request_id": request_id},
        )
    except Exception as e:
        logger.warning(
            "Failed to update s6 container env %s: %s",
            var_name,
            e,
            extra={"request_id": request_id},
        )
