type AnyUser = Record<string, any>;

const pickString = (...vals: Array<any>) => {
  for (const v of vals) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return "";
};

export const normalizeUser = (raw: AnyUser) => {
  const username = pickString(raw.username, raw.user_name, raw.uname);

  const name = pickString(
    raw.name,
    raw.full_name,
    raw.fullName,
    raw.nama_lengkap,
    raw.namaLengkap,
    username,
  );

  const phone = pickString(raw.phone, raw.no_hp, raw.noHp, raw.phone_number);

  const isVerified =
    typeof raw.isVerified === "boolean"
      ? raw.isVerified
      : typeof raw.is_verified === "boolean"
        ? raw.is_verified
        : undefined;

  return {
    id: raw.id,
    name,
    username: username || null,
    email: raw.email,
    phone: phone || null,
    photo_profile: raw.photo_profile ?? null,
    role: raw.role,
    isVerified,
    createdAt: raw.createdAt ?? raw.created_at,
    updatedAt: raw.updatedAt ?? raw.updated_at,
  };
};

export default normalizeUser;