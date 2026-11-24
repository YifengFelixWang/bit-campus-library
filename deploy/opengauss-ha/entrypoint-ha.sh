#!/bin/bash
# openGauss 主备节点初始化脚本（用于课程演示，不用于生产）
# 约定：
#   NODE_NAME=db-a / db-b，NODE_ROLE=primary / standby
#   PGDATA=/var/lib/opengauss/data，数据目录落在宿主机卷里
set -euo pipefail

export GAUSSHOME="${GAUSSHOME:-/usr/local/opengauss}"
export PATH="$GAUSSHOME/bin:$PATH"
export LD_LIBRARY_PATH="$GAUSSHOME/lib:${LD_LIBRARY_PATH:-}"

PGDATA="${PGDATA:-/var/lib/opengauss/data}"
NODE_NAME="${NODE_NAME:-db-a}"
NODE_ROLE="${NODE_ROLE:-primary}"
PEER_HOST="${PEER_HOST:-db-b}"
DB_PORT="${DB_PORT:-5432}"
HA_PORT="${HA_PORT:-5433}"
HA_SERVICE="${HA_SERVICE:-5434}"
GS_PASSWORD="${GS_PASSWORD:-}"
GS_USER="${GS_USER:-gaussdb}"

mkdir -p "$PGDATA"

local_ip() {
    getent hosts "$1" 2>/dev/null | awk '{print $1}' | head -n 1
}

write_config() {
    local self_ip peer_ip
    self_ip="$(local_ip "$NODE_NAME")"
    peer_ip="$(local_ip "$PEER_HOST")"
    [ -n "$self_ip" ] || self_ip="$NODE_NAME"
    [ -n "$peer_ip" ] || peer_ip="$PEER_HOST"
    # build 会带入主节点的配置，先删掉上一次追加的块，避免重复键随重启累积
    sed -i '/# ---- added by entrypoint-ha.sh ----/,$d' "$PGDATA/postgresql.conf"
    cat >> "$PGDATA/postgresql.conf" <<EOF

# ---- added by entrypoint-ha.sh ----
listen_addresses = '*'
port = $DB_PORT
replication_type = 1
application_name = $NODE_NAME
max_connections = 300
max_wal_senders = 8
remote_read_mode = non_authentication
replconninfo1 = 'localhost=$self_ip localport=$HA_PORT localservice=$HA_SERVICE remotehost=$peer_ip remoteport=$HA_PORT remoteservice=$HA_SERVICE'
EOF
    cat > "$PGDATA/pg_hba.conf" <<EOF
local   all   all                  trust
host    all   all   0.0.0.0/0      trust
host    all   all   ::/0           trust
host    replication all 0.0.0.0/0  trust
EOF
}

if [ ! -s "$PGDATA/postgresql.conf" ]; then
    echo "[ha] initializing $NODE_NAME ..."
    gs_initdb -D "$PGDATA" --nodename="$NODE_NAME" -E UTF-8 --locale=C
fi

write_config

echo "[ha] $NODE_NAME role=$NODE_ROLE peer=$PEER_HOST"
if [ "$NODE_ROLE" = "standby" ]; then
    for _ in $(seq 1 60); do
        if gsql -h "$PEER_HOST" -p "$DB_PORT" -U "$GS_USER" -W "$GS_PASSWORD" -d postgres -c "select 1" >/dev/null 2>&1; then
            echo "[ha] peer is ready"
            break
        fi
        sleep 2
    done
fi

if [ "$NODE_ROLE" = "standby" ]; then
    echo "[ha] building standby from $PEER_HOST ..."
    gs_ctl start -D "$PGDATA" -M standby >/dev/null 2>&1 || true
    sleep 3
    gs_ctl stop -D "$PGDATA" >/dev/null 2>&1 || true
    gs_ctl build -D "$PGDATA" -b full -M standby
    # build 会把主节点配置文件复制过来，重写本节点的 replconninfo
    gs_ctl stop -D "$PGDATA" >/dev/null 2>&1 || true
    write_config
    gs_ctl start -D "$PGDATA" -M standby
else
    echo "[ha] starting primary ..."
    gs_ctl start -D "$PGDATA" -M primary
fi

echo "[ha] $NODE_NAME started"
trap 'gs_ctl stop -D "$PGDATA" -m fast >/dev/null 2>&1 || true; exit 0' TERM INT
tail -f /dev/null &
wait $!
