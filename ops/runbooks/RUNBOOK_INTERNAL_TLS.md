# RUNBOOK: Internal TLS Configuration

**Purpose:** Reference document for enabling TLS on internal cluster services.

## Valkey TLS

```yaml
# In valkey deployment, add args:
args:
  - --tls-port 6379
  - --port 0
  - --tls-cert-file /certs/tls.crt
  - --tls-key-file /certs/tls.key
  - --tls-ca-cert-file /certs/ca.crt
```

Update `server/services/valkey.ts` connection string:
```
redis://valkey.tradehub.svc:6379?tls=true
```

## ClickHouse HTTPS

```xml
<!-- In ClickHouse config -->
<https_port>8443</https_port>
<certificate_file>/certs/tls.crt</certificate_file>
<private_key_file>/certs/tls.key</private_key_file>
```

Update `server/services/clickhouseClient.ts`:
```typescript
const client = createClient({ url: "https://tradehub-clickhouse.tradehub.svc:8443" });
```

## MinIO TLS

```bash
# Mount certs to /root/.minio/certs/ in MinIO StatefulSet
# MinIO auto-detects and enables TLS
```

## Certificate Management
Use cert-manager with a ClusterIssuer for automated internal cert rotation:
```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml
```
