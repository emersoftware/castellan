#!/bin/sh
set -eu
# Enforce egress independently of proxy environment variables and the model's tool choices.
iptables -P OUTPUT DROP
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -p tcp -d 10.238.41.2 --dport 4400 -j ACCEPT
iptables -A OUTPUT -p tcp -d 10.238.41.3 --dport 8800 -j ACCEPT
iptables -A OUTPUT -p tcp -d 10.238.41.4 --dport 3128 -j ACCEPT
ip6tables -P OUTPUT DROP
ip6tables -A OUTPUT -o lo -j ACCEPT
# Root supervisor may change UID and terminate its children, but cannot change the firewall anymore.
exec setpriv --bounding-set=-all,+setuid,+setgid,+setpcap,+kill --no-new-privs node --import tsx /app/connectors/open-arena/src/agent.mjs "$@"
