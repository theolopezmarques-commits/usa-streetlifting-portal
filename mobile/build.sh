#!/bin/bash
# Build script: copies web assets into www/ and injects the production API URL.
# Usage:
#   ./build.sh                          (uses localhost for dev)
#   ./build.sh https://your-app.up.railway.app  (uses Railway URL for production)

API_URL="${1:-http://localhost:3000}"

echo "Building mobile app with API_URL=$API_URL"

# Clean and copy web assets
rm -rf www
cp -r ../public www

# Inject API_URL into app.js as the first line
sed -i '' "1s|^|const API_BASE = '${API_URL}';\n|" www/js/app.js

echo "Done. Run: npx cap sync"
