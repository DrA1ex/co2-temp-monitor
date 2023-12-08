#!/bin/bash

COMMAND=${COMMAND="node ./src/server.js"}

while true; do
    # Start the process
    $COMMAND

    # Check if the process exited normally
    if [ $? -eq 0 ]; then
        echo "Process exited normally, not restarting."
        break
    else
        echo "Process exited abnormally, restarting."
        sleep 3  # Add a delay before restart to prevent instant respawn
    fi
done