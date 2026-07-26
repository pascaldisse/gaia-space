#!/bin/bash
# Restart script for Gaia Space application (Web mode)

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Create logs directory if it doesn't exist
mkdir -p logs

# Ensure proper permissions for the logs directory
if [ ! -w "logs" ]; then
  echo "Warning: logs directory not writable, trying to fix permissions..."
  chmod 777 logs || true
fi

# Ensure proper permissions for build directory
if [ -d "build" ]; then
  echo "Ensuring proper permissions for build directory..."
  chmod -R 755 build || true
fi

# Get current timestamp for log files
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# Log file for flutter output
LOG_FILE="logs/app_$TIMESTAMP.log"

# Test if we can write to the log file
touch "$LOG_FILE" 2>/dev/null
if [ $? -ne 0 ]; then
  echo "Warning: Cannot write to log file, will log to stdout only"
  LOG_TO_FILE=false
else
  LOG_TO_FILE=true
fi

# Function to log with or without file 
log_message() {
  if [ "$LOG_TO_FILE" = true ]; then
    echo -e "$1" | tee -a "$LOG_FILE"
  else
    echo -e "$1"
  fi
}

log_message "${BLUE}Gaia Space Web Restart Script${NC}"
log_message "=================================="
log_message "Timestamp: $(date)"
log_message "Environment: $(uname -a)"

# Check if running as root
if [ "$(id -u)" = "0" ]; then
   log_message "${YELLOW}Warning: You are running this script as root.${NC}"
   log_message "${YELLOW}Flutter may refuse to run as root user.${NC}"
   log_message "${YELLOW}Creating a non-root user to run Flutter...${NC}"
   
   # Create a non-root user if we need to run as non-root
   if ! id flutteruser &>/dev/null; then
     useradd -m flutteruser || true
     # Make sure the flutteruser can access the current directory
     chown -R flutteruser:flutteruser "$(pwd)" || true
     chmod -R 755 "$(pwd)" || true
   fi
   
   # Re-run script as flutteruser
   log_message "${YELLOW}Re-running as non-root user...${NC}"
   sudo -u flutteruser bash "$(pwd)/restart.sh"
   exit $?
fi

# Stop any running Flutter processes
log_message "${YELLOW}Stopping any running Flutter processes...${NC}"
pkill -f flutter || true
pkill -f dart || true
sleep 2

# Clean build if needed
if [ "$1" == "--clean" ]; then
  log_message "${YELLOW}Cleaning previous build...${NC}"
  flutter clean 2>&1 | { 
    if [ "$LOG_TO_FILE" = true ]; then
      tee -a "$LOG_FILE"
    else
      cat
    fi
  }
fi

# Get dependencies
log_message "${YELLOW}Installing dependencies...${NC}"
flutter pub get 2>&1 | {
  if [ "$LOG_TO_FILE" = true ]; then
    tee -a "$LOG_FILE"
  else
    cat
  fi
}

# Check if pub get was successful
PUB_GET_STATUS=${PIPESTATUS[0]}
if [ $PUB_GET_STATUS -ne 0 ]; then
  log_message "${RED}Error: Flutter pub get failed with exit code $PUB_GET_STATUS.${NC}"
  exit 1
fi

# Set debug mode for more verbose logging
export GAIA_DEBUG=true
log_message "${YELLOW}Debug mode enabled (GAIA_DEBUG=true)${NC}"

# Set web port and hostname
WEB_PORT=8080
WEB_HOSTNAME="0.0.0.0"  # Bind to all interfaces

log_message "${YELLOW}Starting Flutter web server on port $WEB_PORT...${NC}"
log_message "${GREEN}To access the application, navigate to:${NC} http://$WEB_HOSTNAME:$WEB_PORT"

# Print connectivity check message
log_message "${YELLOW}Note: If the app gets stuck on the splash screen, it might be running connectivity checks.${NC}"
log_message "${YELLOW}The app should eventually proceed to the login screen even if connectivity checks fail.${NC}"

# Run Flutter web server with logging
log_message "${YELLOW}Ignoring file_picker package warnings (known issue)...${NC}"

if [ "$LOG_TO_FILE" = true ]; then
  flutter run -d web-server --web-port=$WEB_PORT --web-hostname=$WEB_HOSTNAME 2>&1 | grep -v "Package file_picker" | tee -a "$LOG_FILE"
  FLUTTER_EXIT_CODE=${PIPESTATUS[0]}
else
  flutter run -d web-server --web-port=$WEB_PORT --web-hostname=$WEB_HOSTNAME 2>&1 | grep -v "Package file_picker"
  FLUTTER_EXIT_CODE=$?
fi

# Check if app started successfully
if [ $FLUTTER_EXIT_CODE -ne 0 ]; then
  log_message "${RED}Error: Failed to start the application in web mode (exit code $FLUTTER_EXIT_CODE).${NC}"
  log_message "${YELLOW}You can try running the app manually with:${NC}"
  log_message "flutter run -d web-server --web-port=$WEB_PORT --web-hostname=$WEB_HOSTNAME"
  if [ "$LOG_TO_FILE" = true ]; then
    log_message "${YELLOW}Check the log file for details: $LOG_FILE${NC}"
  fi
  exit 1
else
  log_message "${GREEN}Application started successfully in web mode!${NC}"
  log_message "${GREEN}Access the application at:${NC} http://$WEB_HOSTNAME:$WEB_PORT"
  if [ "$LOG_TO_FILE" = true ]; then
    log_message "${GREEN}Log file: $LOG_FILE${NC}"
  fi
fi