#!/bin/sh
# Reset the demo as the firm administrator. Usage: scripts/reset.sh <baseUrl> clean|midseason
jar=$(mktemp)
curl -s -c "$jar" -X POST "$1/api/session" -H 'content-type: application/json' -d '{"person":"st-05"}' > /dev/null
curl -s -b "$jar" -X POST "$1/api/admin/reset" -H 'content-type: application/json' -d "{\"scenario\":\"$2\"}"; echo
rm -f "$jar"
