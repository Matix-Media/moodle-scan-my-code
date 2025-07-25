import axios, { AxiosInstance } from "axios";
import qs from "qs";
import { CookieJar } from "tough-cookie";
import Bot from "../bot";
import { moodleConnection } from "../db/schema";

const LOGIN_TOKEN_MATCH_REGEX = /<input type="hidden" name="logintoken" value="([^"]*)">/i;
const LOGIN_ERROR_MATCH_REGEX = /<a href="#" id="loginerrormessage" class="sr-only">([.\S\s]*)<\/a>/i;
const ATTENDANCE_ERROR_MATCH_REGEX = /<p class="errormessage">([.\S\s]*)<\/p>/i;
const ATTENDANCE_SUCCESS_MATCH_REGEX =
    /<div class="alert alert-info alert-block fade in  alert-dismissible" role="alert" data-aria-autofocus="true">([.\S\s]*)<button type="button" class="close" data-dismiss="alert">/i;
const VERBOSE = false;

export default class MoodleSession {
    private bot: Bot;
    private client: AxiosInstance;
    private cookies = new CookieJar();
    private connection: typeof moodleConnection.$inferSelect;

    constructor(bot: Bot, connection: typeof moodleConnection.$inferSelect) {
        this.bot = bot;
        this.connection = connection;
        this.client = axios.create({
            maxRedirects: 0,
            headers: {
                Host: new URL(connection.moodleUrlBase).host,
            },
        });

        this.client.interceptors.request.use((config) => {
            if (VERBOSE) {
                console.log("-------");
                console.log(`>> Request: ${config.method?.toUpperCase()} ${config.url}`);
                console.log(">> Cookies:", this.cookies.getCookieStringSync(config.url!));
                console.log(">> Data:", config.data);
            }
            config.headers["Cookie"] = this.cookies.getCookieStringSync(config.url!);
            return config;
        });

        this.client.interceptors.response.use(
            (res) => {
                if (VERBOSE) {
                    console.log(`<< Response: ${res.status} (${res.statusText}) ${res.headers["location"] ? res.headers["location"] : ""}`);
                    console.log("<< Cookies:", res.headers["set-cookie"]);
                }
                res.headers["set-cookie"]?.forEach((cookie) => {
                    this.cookies.setCookieSync(cookie, res.config.url!);
                });
                return res;
            },
            (error) => {
                if (!axios.isAxiosError(error)) return Promise.reject(error);
                if (VERBOSE) {
                    console.log(
                        `<< ! Response: ${error.status} (${error.response?.statusText}) ${
                            error.response?.headers["location"] ? error.response?.headers["location"] : ""
                        }`,
                    );
                    console.log("<< ! Cookies:", error.response?.headers["set-cookie"]);
                }

                error.response?.headers["set-cookie"]?.forEach((cookie) => {
                    this.cookies.setCookieSync(cookie, error.config!.url!);
                });

                if (![301, 302, 303, 307, 308].includes(error.response?.status ?? 500)) return Promise.reject(error);
                const redirectUrl = error.response?.headers["location"];
                if (!redirectUrl) return Promise.reject(error);

                if (VERBOSE) console.log("<< ! Redirect detected, following...");
                return this.client.get(redirectUrl);
            },
        );
    }

    async login(username: string, password: string) {
        const loginUrl = this.connection.moodleUrlBase + "/login/index.php";

        try {
            const loginTokenRes = await this.client.get(loginUrl);
            const loginTokenMatch = LOGIN_TOKEN_MATCH_REGEX.exec(loginTokenRes.data);
            if (loginTokenMatch == null || loginTokenMatch?.length < 1) {
                throw new Error("Could not find login token");
            }

            const loginRes = await this.client.post(loginUrl, qs.stringify({ username, password, logintoken: loginTokenMatch[1] }), {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            });

            if (!loginRes || loginRes.config.url !== this.connection.moodleUrlBase + "/") {
                const loginErrorMatch = LOGIN_ERROR_MATCH_REGEX.exec(loginRes?.data ?? "");
                if (loginErrorMatch != null && loginErrorMatch?.length > 1) {
                    throw new LoginError("Login failed", loginErrorMatch[1]);
                } else throw new LoginError("Login failed");
            }
        } catch (err) {
            if (err instanceof LoginError) throw err;
            if (axios.isAxiosError(err) && err.response) {
                const loginErrorMatch = LOGIN_ERROR_MATCH_REGEX.exec(err.response.data ?? "");
                if (loginErrorMatch != null && loginErrorMatch?.length > 1) throw new LoginError("Login failed", loginErrorMatch[1]);
                else throw new LoginError("Login failed", err.message);
            } else throw new LoginError("Login failed", String(err));
        }
    }

    async updateAttendance(qrPass: string, sessId: string) {
        const attendanceUrl = this.connection.moodleUrlBase + "/mod/attendance/attendance.php?qrpass=" + qrPass + "&sessid=" + sessId;

        try {
            const response = await this.client.get(attendanceUrl);
            const successMatch = ATTENDANCE_SUCCESS_MATCH_REGEX.exec(response.data);
            if (successMatch == null || successMatch?.length < 1) {
                throw new AttendanceUpdateError("Attendance update failed", "Could not find success message");
            }
            console.log("Attendance updated successfully:", successMatch[1]);
        } catch (err) {
            if (err instanceof AttendanceUpdateError) throw err;
            if (axios.isAxiosError(err) && err.response) {
                const attendanceErrorMatch = ATTENDANCE_ERROR_MATCH_REGEX.exec(err.response.data ?? "");
                if (attendanceErrorMatch != null && attendanceErrorMatch?.length > 1) {
                    throw new AttendanceUpdateError("Attendance update failed", attendanceErrorMatch[1]);
                } else throw new AttendanceUpdateError("Attendance update failed", err.message);
            } else throw new AttendanceUpdateError("Attendance update failed", String(err));
        }
    }
}

export class AttendanceUpdateError extends Error {
    public reason: string | undefined;
    constructor(message: string, reason?: string) {
        super(message);
        this.name = "AttendanceUpdateError";
        this.reason = reason;
    }
}

export class LoginError extends Error {
    public reason: string | undefined;
    constructor(message: string, reason?: string) {
        super(message);
        this.name = "LoginError";
        this.reason = reason;
    }
}
