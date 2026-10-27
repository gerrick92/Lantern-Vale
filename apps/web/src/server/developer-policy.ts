import "server-only";

export function isDeveloperAccount(userId: string) {
  const owner = process.env.DEVELOPER_USER_ID;
  return (
    process.env.NODE_ENV === "development" &&
    !!owner &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      owner,
    ) &&
    userId.toLowerCase() === owner.toLowerCase()
  );
}
