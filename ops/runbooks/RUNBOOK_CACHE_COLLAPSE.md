# RUNBOOK: Cache Collapse (Valkey)

**Trigger Alert:** `ValkeyMemoryPressure` / `CacheHitRateDegraded`

## Symptoms
- Valkey memory at >90% capacity
- Cache hit rate below 50%
- BullMQ job processing slowing down

## Diagnosis

```bash
# 1. Check Valkey memory
kubectl exec -n tradehub deploy/valkey -- redis-cli INFO memory | grep -E "used_memory|maxmemory"

# 2. Check eviction policy
kubectl exec -n tradehub deploy/valkey -- redis-cli CONFIG GET maxmemory-policy

# 3. Check keyspace distribution
kubectl exec -n tradehub deploy/valkey -- redis-cli INFO keyspace
```

## Resolution

```bash
# Set correct eviction policy if wrong
kubectl exec -n tradehub deploy/valkey -- redis-cli CONFIG SET maxmemory-policy allkeys-lru

# Flush non-critical cached data (NOT bull: queues)
kubectl exec -n tradehub deploy/valkey -- redis-cli --scan --pattern "cache:*" | \
  xargs -L 100 kubectl exec -n tradehub deploy/valkey -- redis-cli DEL

# If persistent, scale Valkey memory limit
kubectl patch deployment valkey -n tradehub -p \
  '{"spec":{"template":{"spec":{"containers":[{"name":"valkey","resources":{"limits":{"memory":"2Gi"}}}]}}}}'
```

## Prevention
- Ensure `maxmemory-policy: allkeys-lru` is set in Valkey config
- Monitor `redis_evicted_keys_total` trend on Cache dashboard
