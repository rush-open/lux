---
name: clear-port
description: Kill processes occupying network ports. Use this when dev servers or services fail to start with "address already in use" or "port already in use" errors, when the user mentions port conflicts, stuck processes on specific ports, or needs to free up ports 3000, 8787, 8090, 5432, 6379, or any other port number. Also trigger when the user says things like "clear the port", "kill what's on port X", "free up port X", "port X is stuck", or "can't start the server".
---

Kill processes occupying specified network ports to resolve "address already in use" errors.

## Usage

The user will typically say something like:
- "Clear port 3000"
- "Kill whatever's on port 8787"
- "Port 3000 is stuck, can you free it up?"
- "I'm getting an 'address already in use' error"
- "The dev server won't start because of a port conflict"

Parse port numbers from the user's message. If no specific ports are mentioned, check common Lux development ports and ask which to clear.

## Common Lux Ports

- **3000** — Web (Next.js dev server)
- **8787** — Agent Worker
- **8090** — OpenSandbox API (if running)
- **5432** — PostgreSQL (Docker container)
- **6379** — Redis (Docker container)

## Implementation Steps

### Step 1: Parse Port Numbers

Extract port numbers from the user's input. If none specified:
1. Show the common Lux ports list above
2. Ask which port(s) to clear
3. Wait for user response before proceeding

### Step 2: Check Each Port

For each port, check if anything is listening:

```bash
lsof -ti:PORT
```

If empty (no output), the port is already free — just report that and move to the next port.

If PIDs are found, get detailed process information:

```bash
lsof -i:PORT
```

This shows command name, PID, user, and full command line. Display this to the user.

### Step 3: Safety Check for Critical Ports

**Before killing processes on ports 5432 or 6379** (database services), warn the user and suggest the safer Docker restart approach:

```
⚠️  Port 5432 is used by PostgreSQL (Docker)
⚠️  Port 6379 is used by Redis (Docker)

Safer option: Restart the Docker containers instead of killing processes:
  docker compose -f docker/docker-compose.dev.yml restart postgres
  docker compose -f docker/docker-compose.dev.yml restart redis

Do you want me to restart the containers (safer) or kill the processes directly?
```

Wait for user confirmation. If they choose restart, use the Docker commands. If they choose kill, proceed to Step 4.

For non-critical ports (3000, 8787, 8090, or any others), you can proceed directly to killing without prompting.

### Step 4: Kill the Process

Try graceful termination first (SIGTERM):

```bash
kill PID
```

Wait 2 seconds, then check if it's still running:

```bash
lsof -ti:PORT
```

If still running, use force kill (SIGKILL):

```bash
kill -9 PID
```

### Step 5: Verify and Report

After killing, verify the port is now free:

```bash
lsof -ti:PORT
```

If empty, report success. If still occupied, report that a new process may have claimed it or the kill failed.

## Output Format

Use clear status messages with emojis for visual clarity:

```
🔍 Checking port 3000...
Found process: node (PID 42315)
  Command: /usr/local/bin/node /path/to/next dev --turbopack
  User: cy

Killing PID 42315...
✅ Port 3000 is now free

🔍 Checking port 8787...
✅ Port 8787 is already free (nothing to kill)
```

## Error Handling

### `lsof` Not Available

If `lsof` command is not found:

```bash
# Check if lsof exists
command -v lsof >/dev/null 2>&1
```

If not found, tell the user:
- **macOS**: `brew install lsof` (though it should be pre-installed)
- **Linux**: `sudo apt-get install lsof` or `sudo yum install lsof`

### Invalid Port Number

If the user provides something that's not a valid port (1-65535):

```
❌ Error: "abc" is not a valid port number
Port numbers must be between 1 and 65535
```

### Permission Denied

If the kill command fails with permission denied, it means the process belongs to another user or requires elevated privileges. Tell the user:

```
❌ Permission denied: Cannot kill PID 12345 (owned by root)

You can try:
  sudo kill -9 12345

Or if this is a system service, consider stopping it properly:
  sudo systemctl stop <service-name>
```

### Multiple Processes on Same Port

If `lsof -ti:PORT` returns multiple PIDs, kill all of them in sequence, reporting each one:

```bash
for pid in $(lsof -ti:PORT); do
  echo "Killing PID $pid..."
  kill -9 $pid
done
```

## Examples

**Example 1: Clear single port**
```
User: "clear port 3000"
```
You: Check port 3000, show what's running, kill it, verify it's free.

**Example 2: Clear multiple ports**
```
User: "ports 3000 and 8787 are both stuck"
```
You: Process each port in sequence, showing results for each.

**Example 3: Database port (careful)**
```
User: "kill port 5432"
```
You: Show warning about PostgreSQL, suggest Docker restart, wait for user decision.

**Example 4: Port already free**
```
User: "free up port 8090"
```
You: Check port, find nothing running, report "Port 8090 is already free".
