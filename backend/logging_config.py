"""
Logging configuration for the teleprompter backend.

Provides structured logging with configurable levels and formatting.
"""

import logging
import sys
from typing import Optional


def setup_logging(log_level: str = "INFO") -> logging.Logger:
    """
    Configure structured logging for the application.

    Args:
        log_level: One of DEBUG, INFO, WARNING, ERROR, CRITICAL
                   Defaults to INFO for production use.

    Returns:
        Configured logger instance for the teleprompter application.

    Raises:
        ValueError: If log_level is not a valid logging level.
    """
    # Validate log level
    valid_levels = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
    log_level_upper = log_level.upper()

    if log_level_upper not in valid_levels:
        raise ValueError(
            f"Invalid log level '{log_level}'. "
            f"Must be one of: {', '.join(sorted(valid_levels))}"
        )

    # Get numeric level
    numeric_level = getattr(logging, log_level_upper)

    # Create or get root logger for this application
    logger = logging.getLogger("teleprompter")
    logger.setLevel(numeric_level)

    # Remove existing handlers to avoid duplicate logs
    logger.handlers.clear()

    # Create console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(numeric_level)

    # Create formatter with timestamp, level, module, and message
    formatter = logging.Formatter(
        fmt='%(asctime)s [%(levelname)s] %(name)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    console_handler.setFormatter(formatter)

    # Add handler to logger
    logger.addHandler(console_handler)

    # Prevent propagation to root logger to avoid duplicate logs
    logger.propagate = False

    return logger


def get_logger(module_name: str) -> logging.Logger:
    """
    Get a child logger for a specific module.

    Creates a logger with the naming convention: teleprompter.{module_name}

    Args:
        module_name: Name of the module requesting the logger.

    Returns:
        Logger instance for the specified module.

    Example:
        >>> logger = get_logger("websocket")
        >>> logger.info("Connection established")
        2026-01-23 14:30:00 [INFO] teleprompter.websocket - Connection established
    """
    return logging.getLogger(f"teleprompter.{module_name}")
