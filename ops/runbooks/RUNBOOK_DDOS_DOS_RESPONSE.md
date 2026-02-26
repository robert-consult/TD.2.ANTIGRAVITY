# RUNBOOK: DDoS / DoS Response

**Trigger Alert:** `BruteForceLoginAttempts` / Ingress RPS spike

## Symptoms
- Sustained RPS exceeding ingress `limit-rps: 200`
- Failed login attempts > 50/s
- API latency degradation across all routes

## Diagnosis

```bash
# 1. Check ingress controller logs for volume
kubectl logs -n ingress-nginx -l app.kubernetes.io/component=controller --tail=100

# 2. Identify top source IPs
kubectl logs -n ingress-nginx -l app.kubernetes.io/component=controller --tail=5000 | \
  awk '{print $1}' | sort | uniq -c | sort -rn | head -20

# 3. Check OVH Anti-DDoS dashboard
# → https://www.ovh.com/manager/ → Network → Anti-DDoS
```

## Immediate Mitigation

```bash
# Tighten ingress rate limits
kubectl annotate ingress tradehub-ingress -n tradehub \
  nginx.ingress.kubernetes.io/limit-rps="50" --overwrite

# Block specific IPs via ConfigMap
kubectl create configmap blocked-ips -n tradehub \
  --from-literal=blocked="1.2.3.4,5.6.7.8" --dry-run=client -o yaml | kubectl apply -f -
```

## Escalation
- If volumetric (>10Gbps): Engage OVH DDoS scrubbing via support ticket
- If application-layer: Deploy WAF rules via ingress `server-snippet`
