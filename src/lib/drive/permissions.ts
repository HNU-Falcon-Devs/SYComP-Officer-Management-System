export type DriveShareMode = "domain" | "unlisted";

export type DrivePermissionPayload =
    | {
          type: "domain";
          domain: string;
          role: "reader";
          allowFileDiscovery: false;
      }
    | {
          type: "anyone";
          role: "reader";
          allowFileDiscovery: false;
      };

export function buildDrivePermissionPayload(config: {
    shareMode: DriveShareMode;
    universityEmailDomain: string;
}): DrivePermissionPayload {
    if (config.shareMode === "unlisted") {
        return {
            type: "anyone",
            role: "reader",
            allowFileDiscovery: false,
        };
    }

    return {
        type: "domain",
        domain: config.universityEmailDomain.trim().toLowerCase(),
        role: "reader",
        allowFileDiscovery: false,
    };
}
