/** today's date in the server's time zone (Asia/Jakarta), as YYYY-MM-DD and as a UTC-midnight Date like @db.Date values */
export const localIso = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
export const todayDate = () => new Date(localIso());
