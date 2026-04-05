import crypto from "node:crypto";

function nowIso() {
  return new Date().toISOString();
}

function addDays(days) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString();
}

function maskLicenseKey(licenseKey) {
  const parts = licenseKey.split("-");
  if (parts.length < 3) {
    return licenseKey;
  }

  return `${parts[0]}-${parts[1]}-****-****-${parts.at(-1)}`;
}

function generateLicenseKey() {
  const chunks = Array.from({ length: 4 }, () =>
    crypto.randomBytes(2).toString("hex").toUpperCase()
  );
  return `KH-${chunks.join("-")}`;
}

function generateSessionToken() {
  return crypto.randomBytes(24).toString("hex");
}

function normalizeStatus(license) {
  if (!license) {
    return "invalid";
  }

  if (license.status === "revoked") {
    return "revoked";
  }

  if (license.expires_at && new Date(license.expires_at) <= new Date()) {
    return "expired";
  }

  return license.status;
}

export function createLicenseService(db) {
  const insertLicense = db.prepare(`
    INSERT INTO licenses (
      license_key,
      duration_type,
      duration_value,
      created_at,
      status,
      note
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const findLicenseByKey = db.prepare(`
    SELECT * FROM licenses WHERE license_key = ?
  `);

  const findLicenseBySession = db.prepare(`
    SELECT * FROM licenses WHERE session_token = ?
  `);

  const updateLicenseActivation = db.prepare(`
    UPDATE licenses
    SET activated_at = ?,
        expires_at = ?,
        status = ?,
        bound_install_id = ?,
        session_token = ?
    WHERE id = ?
  `);

  const updateSessionToken = db.prepare(`
    UPDATE licenses
    SET session_token = ?, status = ?
    WHERE id = ?
  `);

  const expireLicense = db.prepare(`
    UPDATE licenses
    SET status = 'expired'
    WHERE id = ?
  `);

  const revokeLicense = db.prepare(`
    UPDATE licenses
    SET status = 'revoked'
    WHERE license_key = ?
  `);

  const insertActivation = db.prepare(`
    INSERT INTO activations (license_id, install_id, activated_at, mod_version)
    VALUES (?, ?, ?, ?)
  `);

  function createLicense({ durationType, durationValue, note }) {
    const licenseKey = generateLicenseKey();
    insertLicense.run(
      licenseKey,
      durationType,
      durationType === "lifetime" ? null : durationValue,
      nowIso(),
      "unused",
      note ?? ""
    );

    return getLicenseInfo(licenseKey);
  }

  function getLicenseInfo(licenseKey) {
    const license = findLicenseByKey.get(licenseKey);
    if (!license) {
      return null;
    }

    const normalizedStatus = normalizeStatus(license);
    if (normalizedStatus === "expired" && license.status !== "expired") {
      expireLicense.run(license.id);
      license.status = "expired";
    }

    return {
      licenseKey: license.license_key,
      durationType: license.duration_type,
      durationValue: license.duration_value,
      createdAt: license.created_at,
      activatedAt: license.activated_at,
      expiresAt: license.expires_at,
      status: normalizedStatus,
      boundInstallId: license.bound_install_id,
      note: license.note ?? "",
      licenseKeyMasked: maskLicenseKey(license.license_key)
    };
  }

  function activateLicense({ licenseKey, installId, modVersion }) {
    const license = findLicenseByKey.get(licenseKey);
    if (!license) {
      return { success: false, status: "invalid", message: "License key not found." };
    }

    const normalizedStatus = normalizeStatus(license);
    if (normalizedStatus === "revoked") {
      return { success: false, status: "revoked", message: "License revoked." };
    }

    if (normalizedStatus === "expired") {
      expireLicense.run(license.id);
      return { success: false, status: "expired", message: "License expired." };
    }

    if (license.bound_install_id && license.bound_install_id !== installId) {
      return { success: false, status: "bound_to_other_device", message: "License already used on another device." };
    }

    const activationTime = license.activated_at ?? nowIso();
    const expiresAt = license.duration_type === "lifetime"
      ? null
      : (license.expires_at ?? addDays(Number(license.duration_value ?? 0)));
    const sessionToken = generateSessionToken();

    updateLicenseActivation.run(
      activationTime,
      expiresAt,
      "active",
      installId,
      sessionToken,
      license.id
    );

    if (!license.activated_at) {
      insertActivation.run(license.id, installId, activationTime, modVersion ?? "");
    }

    return {
      success: true,
      status: "active",
      message: "License activated.",
      sessionToken,
      expiresAt,
      licenseKeyMasked: maskLicenseKey(license.license_key),
      event: {
        type: "activated",
        licenseKey: license.license_key,
        installId,
        expiresAt,
        modVersion: modVersion ?? ""
      }
    };
  }

  function validateLicense({ sessionToken, installId, modVersion }) {
    const license = findLicenseBySession.get(sessionToken);
    if (!license) {
      return { success: false, status: "invalid", message: "Unknown session." };
    }

    const normalizedStatus = normalizeStatus(license);
    if (normalizedStatus === "expired") {
      expireLicense.run(license.id);
      return { success: false, status: "expired", message: "License expired." };
    }

    if (normalizedStatus === "revoked") {
      return { success: false, status: "revoked", message: "License revoked." };
    }

    if (license.bound_install_id !== installId) {
      return { success: false, status: "device_mismatch", message: "License belongs to another device." };
    }

    const refreshedToken = generateSessionToken();
    updateSessionToken.run(refreshedToken, "active", license.id);

    return {
      success: true,
      status: "active",
      message: "License valid.",
      expiresAt: license.expires_at,
      sessionToken: refreshedToken,
      event: {
        type: "validated",
        licenseKey: license.license_key,
        installId,
        expiresAt: license.expires_at,
        modVersion: modVersion ?? ""
      }
    };
  }

  function revoke(licenseKey) {
    const result = revokeLicense.run(licenseKey);
    return result.changes > 0;
  }

  return {
    createLicense,
    activateLicense,
    validateLicense,
    getLicenseInfo,
    revoke
  };
}
