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

function mapLicense(license) {
  if (!license) {
    return null;
  }

  return {
    ...license,
    created_at: license.created_at?.toISOString?.() ?? license.created_at,
    activated_at: license.activated_at?.toISOString?.() ?? license.activated_at,
    expires_at: license.expires_at?.toISOString?.() ?? license.expires_at
  };
}

export function createLicenseService(db) {
  async function createLicense({ minecraftNick, durationType, durationValue, note }) {
    const licenseKey = generateLicenseKey();
    await db.query(
      `
        INSERT INTO licenses (
          license_key,
          minecraft_nick,
          duration_type,
          duration_value,
          created_at,
          status,
          note
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        licenseKey,
        minecraftNick,
        durationType,
        durationType === "lifetime" ? null : durationValue,
        nowIso(),
        "unused",
        note ?? ""
      ]
    );

    return getLicenseInfo(licenseKey);
  }

  async function getLicenseInfo(licenseKey) {
    const result = await db.query(
      `SELECT * FROM licenses WHERE license_key = $1`,
      [licenseKey]
    );
    const license = mapLicense(result.rows[0]);
    if (!license) {
      return null;
    }

    const normalizedStatus = normalizeStatus(license);
    if (normalizedStatus === "expired" && license.status !== "expired") {
      await db.query(`UPDATE licenses SET status = 'expired' WHERE id = $1`, [license.id]);
      license.status = "expired";
    }

    return {
      licenseKey: license.license_key,
      minecraftNick: license.minecraft_nick,
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

  async function getLicenseInfoByNickname(minecraftNick) {
    const result = await db.query(
      `
        SELECT * FROM licenses
        WHERE LOWER(minecraft_nick) = LOWER($1)
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [minecraftNick]
    );

    const license = mapLicense(result.rows[0]);
    if (!license) {
      return null;
    }

    const normalizedStatus = normalizeStatus(license);
    if (normalizedStatus === "expired" && license.status !== "expired") {
      await db.query(`UPDATE licenses SET status = 'expired' WHERE id = $1`, [license.id]);
      license.status = "expired";
    }

    return {
      licenseKey: license.license_key,
      minecraftNick: license.minecraft_nick,
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

  async function listLicenses({ status, page, pageSize }) {
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.max(1, Math.min(20, Number(pageSize) || 5));
    const offset = (safePage - 1) * safePageSize;

    const filters = [];
    const values = [];

    if (status === "active") {
      filters.push(`status = 'active'`);
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

    const countResult = await db.query(
      `SELECT COUNT(*)::int AS total FROM licenses ${whereClause}`,
      values
    );
    const total = countResult.rows[0]?.total ?? 0;

    const listResult = await db.query(
      `
        SELECT *
        FROM licenses
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
      `,
      [...values, safePageSize, offset]
    );

    const items = await Promise.all(listResult.rows.map(async rawLicense => {
      const license = mapLicense(rawLicense);
      const normalizedStatus = normalizeStatus(license);
      if (normalizedStatus === "expired" && license.status !== "expired") {
        await db.query(`UPDATE licenses SET status = 'expired' WHERE id = $1`, [license.id]);
        license.status = "expired";
      }

      return {
        licenseKey: license.license_key,
        minecraftNick: license.minecraft_nick,
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
    }));

    return {
      page: safePage,
      pageSize: safePageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / safePageSize)),
      items
    };
  }

  async function activateLicense({ licenseKey, installId, modVersion }) {
    const result = await db.query(
      `SELECT * FROM licenses WHERE license_key = $1`,
      [licenseKey]
    );
    const license = mapLicense(result.rows[0]);
    if (!license) {
      return { success: false, status: "invalid", message: "License key not found." };
    }

    const normalizedStatus = normalizeStatus(license);
    if (normalizedStatus === "revoked") {
      return { success: false, status: "revoked", message: "License revoked." };
    }

    if (normalizedStatus === "expired") {
      await db.query(`UPDATE licenses SET status = 'expired' WHERE id = $1`, [license.id]);
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

    await db.query(
      `
        UPDATE licenses
        SET activated_at = $1,
            expires_at = $2,
            status = $3,
            bound_install_id = $4,
            session_token = $5
        WHERE id = $6
      `,
      [activationTime, expiresAt, "active", installId, sessionToken, license.id]
    );

    if (!license.activated_at) {
      await db.query(
        `
          INSERT INTO activations (license_id, install_id, activated_at, mod_version)
          VALUES ($1, $2, $3, $4)
        `,
        [license.id, installId, activationTime, modVersion ?? ""]
      );
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

  async function validateLicense({ sessionToken, installId, modVersion }) {
    const result = await db.query(
      `SELECT * FROM licenses WHERE session_token = $1`,
      [sessionToken]
    );
    const license = mapLicense(result.rows[0]);
    if (!license) {
      return { success: false, status: "invalid", message: "Unknown session." };
    }

    const normalizedStatus = normalizeStatus(license);
    if (normalizedStatus === "expired") {
      await db.query(`UPDATE licenses SET status = 'expired' WHERE id = $1`, [license.id]);
      return { success: false, status: "expired", message: "License expired." };
    }

    if (normalizedStatus === "revoked") {
      return { success: false, status: "revoked", message: "License revoked." };
    }

    if (license.bound_install_id !== installId) {
      return { success: false, status: "device_mismatch", message: "License belongs to another device." };
    }

    const refreshedToken = generateSessionToken();
    await db.query(
      `
        UPDATE licenses
        SET session_token = $1, status = $2
        WHERE id = $3
      `,
      [refreshedToken, "active", license.id]
    );

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

  async function revoke(licenseKey) {
    const result = await db.query(
      `
        UPDATE licenses
        SET status = 'revoked'
        WHERE license_key = $1
      `,
      [licenseKey]
    );

    return result.rowCount > 0;
  }

  return {
    createLicense,
    activateLicense,
    validateLicense,
    getLicenseInfo,
    getLicenseInfoByNickname,
    listLicenses,
    revoke
  };
}
