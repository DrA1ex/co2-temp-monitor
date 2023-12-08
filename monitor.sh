#!/bin/bash

COMMAND=${COMMAND="node ./src/server.js"}

while true; do
    # Start the process
    $COMMAND

    echo "Process exited, restarting."
    sleep 3  # Add a delay before restart to prevent instant respawn
done