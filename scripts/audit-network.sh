#!/usr/bin/env bash
# No-dashboard network audit.
#
# Start the development desktop app with a fresh TTMD_DATA_DIR under Xvfb and
# watch for outbound TCP or UDP traffic. With no vault and no profile the app
# stays on the setup screen, so it must not connect anywhere except loopback.
#
# CI uses strace, which sees every connect(2) and sendto(2) made by the app and
# its children. A local run without strace falls back to polling `ss`, which
# samples open sockets and can miss a connection that opens and closes between
# polls.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AUDIT_DIR="$ROOT/.tmp/audit-network"
DATA_DIR="$AUDIT_DIR/data"
AUDIT_LOG="$AUDIT_DIR/audit.log"
ELECTRON_LOG="$AUDIT_DIR/electron.log"
TRACE_LOG="$AUDIT_DIR/strace.log"
SS_LOG="$AUDIT_DIR/ss.log"
SS_VIOLATIONS="$AUDIT_DIR/ss-violations.log"
STRACE_VIOLATIONS="$AUDIT_DIR/strace-violations.log"

AUDIT_SECONDS="${TTMD_AUDIT_SECONDS:-8}"
START_TIMEOUT="${TTMD_AUDIT_START_TIMEOUT:-20}"
REQUESTED_METHOD="${TTMD_AUDIT_METHOD:-auto}"
launch_pid=""

rm -rf "$AUDIT_DIR"
mkdir -p "$DATA_DIR"
: > "$AUDIT_LOG"
: > "$SS_LOG"
: > "$SS_VIOLATIONS"
: > "$STRACE_VIOLATIONS"

say() {
  printf '%s\n' "$*" | tee -a "$AUDIT_LOG"
}

fail() {
  say "FAIL: $*" >&2
  if [[ -s "$ELECTRON_LOG" ]]; then
    say "Last app output:" >&2
    tail -n 20 "$ELECTRON_LOG" | tee -a "$AUDIT_LOG" >&2
  fi
  say "Audit log: ${AUDIT_LOG#"$ROOT"/}" >&2
  exit 1
}

now_ms() {
  date +%s%3N
}

process_alive() {
  local state
  state="$(ps -o stat= -p "$1" 2>/dev/null || true)"
  [[ -n "$state" && "${state:0:1}" != "Z" ]]
}

# Print the app tree: the Electron helpers and the Go core spawned under the
# launch wrapper. Xvfb and strace are part of the launch but not the app.
app_pids() {
  ps -e -o pid=,ppid=,comm= 2>/dev/null | awk -v root="$1" '
    {
      children[$2] = children[$2] " " $1
      comm[$1] = $3
    }
    END {
      queue[1] = root
      head = 1
      tail = 1
      while (head <= tail) {
        pid = queue[head++]
        if (comm[pid] != "Xvfb" && comm[pid] != "xvfb-run" && comm[pid] != "strace") {
          print pid
        }
        count = split(children[pid], kids, " ")
        for (i = 1; i <= count; i++) {
          if (kids[i] != "") queue[++tail] = kids[i]
        }
      }
    }'
}

# Is anything still running in the launch session? setsid made the launcher
# its leader, so this also finds children that outlived the wrapper.
pgid_exists() {
  ps -e -o pgid= 2>/dev/null |
    awk -v pgid="$1" '$1 == pgid { found = 1 } END { exit(found ? 0 : 1) }'
}

# Stop the app before the wrapper so xvfb-run can stop Xvfb and remove its
# temporary auth files. The whole session is the fallback if something hangs.
stop_app() {
  local root="$1"
  local pids="" pgid="" i
  [[ -n "$root" ]] || return 0

  if process_alive "$root"; then
    pids="$(app_pids "$root" | tr '\n' ' ')" || pids=""
    if [[ -n "${pids//[[:space:]]/}" ]]; then
      # Word splitting is intended: pids is a space-separated list.
      kill -TERM $pids 2>/dev/null || true
    fi

    for ((i = 0; i < 50; i++)); do
      process_alive "$root" || break
      sleep 0.1
    done
  fi

  # If the wrapper or a child is still alive, clear the launch session.
  pgid="$(ps -o pgid= -p "$root" 2>/dev/null | tr -d ' ' || true)"
  if [[ -n "$pgid" && "$pgid" != "$root" ]]; then
    kill -TERM "$root" 2>/dev/null || true
    return 0
  fi
  if pgid_exists "$root"; then
    kill -TERM -- "-$root" 2>/dev/null || true
    for ((i = 0; i < 20; i++)); do
      pgid_exists "$root" || return 0
      sleep 0.1
    done
    kill -KILL -- "-$root" 2>/dev/null || true
  fi
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "$launch_pid" ]]; then
    stop_app "$launch_pid"
    wait "$launch_pid" 2>/dev/null || true
  fi
  exit "$status"
}

# Log a whole ss snapshot, then keep only non-loopback peers owned by the app.
# LISTEN sockets and unconnected `*` / 0.0.0.0 peers are not outbound traffic.
check_ss_snapshot() {
  local pids="$1"
  local snapshot="$2"

  printf '%s\n' "$snapshot" | awk -v pids="$pids" '
    BEGIN {
      count = split(pids, list, " ")
      for (i = 1; i <= count; i++) {
        if (list[i] != "") tracked[list[i]] = 1
      }
    }
    {
      if ($2 == "LISTEN") next

      peer = $6
      if (peer == "") next

      host = peer
      if (substr(host, 1, 1) == "[") {
        bracket = index(host, "]")
        if (bracket == 0) next
        host = substr(host, 2, bracket - 2)
      } else {
        colon = match(host, /:[0-9*]+$/)
        if (colon > 0) host = substr(host, 1, colon - 1)
      }
      sub(/%.*$/, "", host)

      if (host == "*" || host == "0.0.0.0" || host == "::") next
      if (host == "::1") next
      if (host ~ /^127\./) next
      if (host ~ /^::ffff:127\./) next

      found = 0
      rest = $0
      while (match(rest, /pid=[0-9]+/)) {
        pid = substr(rest, RSTART + 4, RLENGTH - 4)
        if (pid in tracked) {
          found = 1
          break
        }
        rest = substr(rest, RSTART + RLENGTH)
      }
      if (found) print
    }'
}

# strace prints sockaddr_in as inet_addr("...") and sockaddr_in6 as
# inet_pton(AF_INET6, "..."). AF_UNIX and AF_NETLINK are not internet traffic.
check_strace_log() {
  awk '
    function ipv4(line) {
      if (match(line, /inet_addr\("[^"]*"\)/)) {
        value = substr(line, RSTART, RLENGTH)
        sub(/^inet_addr\("/, "", value)
        sub(/"\)$/, "", value)
        return value
      }
      return ""
    }
    function ipv6(line) {
      if (match(line, /inet_pton\(AF_INET6, "[^"]*"\)/)) {
        value = substr(line, RSTART, RLENGTH)
        sub(/^inet_pton\(AF_INET6, "/, "", value)
        sub(/"\)$/, "", value)
        return value
      }
      return ""
    }
    /sa_family=AF_INET6,/ {
      address = ipv6($0)
      if (address == "") { print; next }
      if (address == "::1") next
      if (address ~ /^::ffff:127\./) next
      print
      next
    }
    /sa_family=AF_INET,/ {
      address = ipv4($0)
      if (address == "") { print; next }
      if (address ~ /^127\./) next
      print
    }
  ' "$TRACE_LOG" > "$STRACE_VIOLATIONS"
}

wait_for_core() {
  local deadline now
  deadline=$(($(now_ms) + START_TIMEOUT * 1000))
  while :; do
    process_alive "$launch_pid" ||
      fail "the app exited before its core control socket appeared"
    if [[ -S "$DATA_DIR/core/control.sock" ]]; then
      return 0
    fi
    now=$(now_ms)
    if ((now >= deadline)); then
      fail "the app did not create its core control socket within ${START_TIMEOUT}s"
    fi
    sleep 0.1
  done
}

run_ss_audit() {
  local deadline now pids snapshot started=0 end_ms=0
  deadline=$(($(now_ms) + START_TIMEOUT * 1000))

  while :; do
    now=$(now_ms)
    process_alive "$launch_pid" || fail "the app exited during the audit"

    pids="$(app_pids "$launch_pid" | tr '\n' ' ')" || pids=""
    if ! snapshot="$(ss -H -tunap 2>/dev/null)"; then
      fail "ss failed to list sockets; cannot audit network traffic"
    fi
    if [[ -n "$snapshot" ]]; then
      printf '# %s pids=%s\n%s\n' "$(date -u +%H:%M:%SZ)" "$pids" "$snapshot" >>"$SS_LOG"
      if [[ "$pids" == *[![:space:]]* ]]; then
        check_ss_snapshot "$pids" "$snapshot" >>"$SS_VIOLATIONS"
      fi
    fi

    if [[ "$started" -eq 0 && -S "$DATA_DIR/core/control.sock" ]]; then
      if [[ "$pids" != *[![:space:]]* ]]; then
        fail "the app is running but its process tree could not be identified"
      fi
      started=1
      end_ms=$((now + AUDIT_SECONDS * 1000))
      say "App is ready; auditing with ss for ${AUDIT_SECONDS}s."
    fi

    if [[ "$started" -eq 0 ]]; then
      if ((now >= deadline)); then
        fail "the app did not create its core control socket within ${START_TIMEOUT}s"
      fi
    elif ((now >= end_ms)); then
      break
    fi

    sleep 0.1
  done
}

run_strace_audit() {
  wait_for_core
  say "App is ready; auditing with strace for ${AUDIT_SECONDS}s."
  sleep "$AUDIT_SECONDS"
  process_alive "$launch_pid" || fail "the app exited during the audit"
  [[ -S "$DATA_DIR/core/control.sock" ]] ||
    fail "the core control socket disappeared during the audit"
}

say "Tunnel to My Dash network audit"
say "Data directory: ${DATA_DIR#"$ROOT"/} (fresh, no vault or profile)"
say "Window: ${AUDIT_SECONDS}s after startup"

if [[ ! "$AUDIT_SECONDS" =~ ^[0-9]+$ ]] || ((AUDIT_SECONDS < 1)); then
  fail "TTMD_AUDIT_SECONDS must be a positive integer"
fi
if [[ ! "$START_TIMEOUT" =~ ^[0-9]+$ ]] || ((START_TIMEOUT < 1)); then
  fail "TTMD_AUDIT_START_TIMEOUT must be a positive integer"
fi

method="$REQUESTED_METHOD"
case "$method" in
  auto)
    if command -v strace >/dev/null 2>&1; then
      method=strace
    else
      method=ss
    fi
    ;;
  strace | ss) ;;
  *)
    fail "TTMD_AUDIT_METHOD must be auto, strace or ss"
    ;;
esac

if [[ "$method" == "ss" && -n "${CI:-}" ]]; then
  fail "strace is required in CI; the ss fallback is for local runs only"
fi
if [[ "$method" == "strace" ]]; then
  command -v strace >/dev/null 2>&1 || fail "strace is not installed"
  if ! strace -f -qq -e trace=connect -o /dev/null true >/dev/null 2>&1; then
    if [[ "$REQUESTED_METHOD" == "auto" && -z "${CI:-}" ]]; then
      say "WARN: strace cannot trace on this machine; falling back to ss." >&2
      method=ss
    else
      fail "strace cannot trace on this machine"
    fi
  fi
fi
if [[ "$method" == "ss" ]]; then
  command -v ss >/dev/null 2>&1 || fail "ss is not installed"
fi

command -v xvfb-run >/dev/null 2>&1 || fail "xvfb-run is not installed (install xvfb)"
command -v xauth >/dev/null 2>&1 || fail "xauth is not installed (install xauth)"
command -v setsid >/dev/null 2>&1 || fail "setsid is not installed (install util-linux)"
[[ -x "$ROOT/build/ttmd-core" ]] || fail "build/ttmd-core is missing; run make core"
[[ -x "$ROOT/desktop/node_modules/.bin/electron" ]] ||
  fail "desktop dependencies are missing; run make desktop-deps"
[[ -d "$ROOT/desktop/dist" ]] || fail "desktop build is missing; run make desktop-check"

electron_args=(./node_modules/.bin/electron --ozone-platform=x11)
if [[ -n "${CI:-}" ]]; then
  # GitHub's Ubuntu runner restricts unprivileged user namespaces, so Chromium
  # cannot start its setuid sandbox there. The audit checks network traffic,
  # not the browser sandbox; the packaged AppImage still runs sandboxed.
  electron_args+=(--no-sandbox)
fi
electron_args+=(.)
launch=(xvfb-run -a -s "-screen 0 1280x800x24" "${electron_args[@]}")
if [[ "$method" == "strace" ]]; then
  launch=(strace -f -qq -e trace=connect,sendto -o "$TRACE_LOG" "${launch[@]}")
fi
say "Method: ${method}"

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

(
  cd "$ROOT/desktop"
  unset TTMD_SMOKE TTMD_NETLOG TTMD_CORE TTMD_CLIPBOARD_MS
  # Keep the app on Xvfb even when the developer session is Wayland.
  unset WAYLAND_DISPLAY WAYLAND_SOCKET
  export TTMD_DATA_DIR="$DATA_DIR"
  exec setsid "${launch[@]}" >"$ELECTRON_LOG" 2>&1
) &
launch_pid=$!

if [[ "$method" == "strace" ]]; then
  run_strace_audit
else
  run_ss_audit
fi

stop_app "$launch_pid"
wait "$launch_pid" 2>/dev/null || true
launch_pid=""

if [[ "$method" == "strace" ]]; then
  [[ -f "$TRACE_LOG" ]] || fail "strace did not write $TRACE_LOG"
  check_strace_log
  if [[ -s "$STRACE_VIOLATIONS" ]]; then
    say "FAIL: non-loopback TCP/UDP connect or sendto calls:" >&2
    while IFS= read -r line; do
      say "  $line" >&2
    done < <(sort -u "$STRACE_VIOLATIONS")
    say "Audit log: ${AUDIT_LOG#"$ROOT"/}" >&2
    exit 1
  fi
else
  if [[ -s "$SS_VIOLATIONS" ]]; then
    say "FAIL: non-loopback TCP/UDP sockets owned by the app:" >&2
    while IFS= read -r line; do
      say "  $line" >&2
    done < <(sort -u "$SS_VIOLATIONS")
    say "Audit log: ${AUDIT_LOG#"$ROOT"/}" >&2
    exit 1
  fi
fi

say "PASS: no non-loopback TCP/UDP connections from the app during the ${AUDIT_SECONDS}s audit."
say "Audit log: ${AUDIT_LOG#"$ROOT"/}"
