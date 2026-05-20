export type ArchitectureImplementationStatus = "implemented" | "integration_pending";

export interface ArchitectureCapability {
  name: string;
  status: ArchitectureImplementationStatus;
  service: string;
}

export interface ArchitectureDomain {
  name: string;
  service: string;
  capabilities: ArchitectureCapability[];
}

export interface ArchitectureCoverageReport {
  system: "Cacsms Trader";
  generatedAt: string;
  domains: ArchitectureDomain[];
  missingCapabilities: string[];
}

export interface DomainAssessment {
  score: number;
  reasons: string[];
  assessedAt: string;
}
