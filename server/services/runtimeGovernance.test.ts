// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  parseApiDeploymentManifest,
  parseConfigMapDataValue,
  parseHpaManifest,
} from "./runtimeGovernance";

describe("runtimeGovernance helpers", () => {
  it("parses config map values for deploy-owned env keys", () => {
    const content = `
data:
  APP_URL: "https://tradehub.example.com"
  COOKIE_SECURE: "true"
  EXPORT_OBJECT_STORAGE_USE_SSL: "false"
`;

    expect(parseConfigMapDataValue(content, "APP_URL")).toBe("https://tradehub.example.com");
    expect(parseConfigMapDataValue(content, "COOKIE_SECURE")).toBe("true");
    expect(parseConfigMapDataValue(content, "MISSING_KEY")).toBeNull();
  });

  it("parses api deployment manifest scalars used by the governance inspector", () => {
    const content = `
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: api
          image: example/tradehub:latest
          readinessProbe:
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            initialDelaySeconds: 15
            periodSeconds: 20
          resources:
            requests:
              cpu: "250m"
              memory: "512Mi"
            limits:
              cpu: "1"
              memory: "1Gi"
`;

    expect(parseApiDeploymentManifest(content)).toEqual({
      replicas: 2,
      readinessInitialDelaySeconds: 5,
      readinessPeriodSeconds: 10,
      livenessInitialDelaySeconds: 15,
      livenessPeriodSeconds: 20,
      cpuRequest: "250m",
      memoryRequest: "512Mi",
      cpuLimit: "1",
      memoryLimit: "1Gi",
      image: "example/tradehub:latest",
    });
  });

  it("parses hpa bounds and ws target values", () => {
    const content = `
spec:
  minReplicas: 2
  maxReplicas: 16
  metrics:
    - type: Resource
      resource:
        target:
          averageUtilization: 70
    - type: Pods
      pods:
        target:
          averageValue: "2500"
`;

    expect(parseHpaManifest(content)).toEqual({
      minReplicas: 2,
      maxReplicas: 16,
      cpuAverageUtilization: 70,
      wsActiveConnectionsTarget: "2500",
    });
  });
});
