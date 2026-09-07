#!/bin/sh
set -e

cd "$(dirname "$0")/.."

AUTH_INSTANCE="mcp-xsuaa"
AUTH_KEY="mcp-xsuaa-key"
DEST_INSTANCE="mcp-destination"
DEST_KEY="mcp-destination-key"
AICORE_INSTANCE="ai-core-instance"
AICORE_KEY="ai-core-instance-key"

# Check CF CLI is logged in
if ! cf target > /dev/null 2>&1; then
    echo "Error: Not logged in to CF CLI. Run 'cf login' first."
    exit 1
fi

echo "Fetching service key for $AUTH_INSTANCE..."
cf create-service-key "$AUTH_INSTANCE" "$AUTH_KEY" 2>/dev/null || true
AUTH_CREDS=$(cf service-key "$AUTH_INSTANCE" "$AUTH_KEY" | tail -n +2)

echo "Fetching service key for $DEST_INSTANCE..."
cf create-service-key "$DEST_INSTANCE" "$DEST_KEY" 2>/dev/null || true
DEST_CREDS=$(cf service-key "$DEST_INSTANCE" "$DEST_KEY" | tail -n +2)

echo "Fetching service key for $AICORE_INSTANCE..."
cf create-service-key "$AICORE_INSTANCE" "$AICORE_KEY" 2>/dev/null || true
AICORE_CREDS=$(cf service-key "$AICORE_INSTANCE" "$AICORE_KEY" | tail -n +2)

echo "Writing default-env.json..."
node -e "
// cf service-key wraps the actual credentials in a 'credentials' envelope — unwrap it
function unwrap(raw) {
    const parsed = JSON.parse(raw);
    return parsed.credentials || parsed;
}

const authCreds = unwrap(process.argv[1]);
const destCreds = unwrap(process.argv[2]);
const aicoreCreds = unwrap(process.argv[3]);

const env = {
    PORT: 4004,
    VCAP_SERVICES: {
        xsuaa: [{
            name: '$AUTH_INSTANCE',
            label: 'xsuaa',
            tags: ['xsuaa'],
            credentials: authCreds
        }],
        destination: [{
            name: '$DEST_INSTANCE',
            label: 'destination',
            tags: ['destination'],
            credentials: destCreds
        }],
        aicore: [{
            name: '$AICORE_INSTANCE',
            label: 'aicore',
            tags: ['aicore'],
            credentials: aicoreCreds
        }]
    }
};

require('fs').writeFileSync('default-env.json', JSON.stringify(env, null, 2));
" "$AUTH_CREDS" "$DEST_CREDS" "$AICORE_CREDS"

echo "Done. default-env.json created."
