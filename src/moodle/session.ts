import axios, { AxiosResponse } from "axios";
import Bot from "../bot";

const LOGIN_TOKEN_MATCH_REGEX = /<input type="hidden" name="logintoken" value="([^"]*)">/i;
const LOGIN_ERROR_MATCH_REGEX = /<a href="#" id="loginerrormessage" class="sr-only">([^"]*)<\/a>/i;

export default class MoodleSession {
    private bot: Bot;
    private cookies: string[] = [];

    constructor(bot: Bot) {
        this.bot = bot;
    }

    async login(username: string, password: string) {
        const loginUrl = this.bot.moodleUrlBase + "/login/index.php";

        const loginTokenRes = await axios.get(loginUrl);
        const loginTokenMatch = LOGIN_TOKEN_MATCH_REGEX.exec(loginTokenRes.data);
        if (loginTokenMatch == null || loginTokenMatch?.length < 1) {
            throw new Error("Could not find login token");
        }

        loginTokenRes.headers["set-cookie"]?.forEach((cookie) => {
            this.cookies.push(cookie.split(";")[0]);
        });

        let res: AxiosResponse | undefined;
        try {
            res = await axios.post(
                loginUrl,
                { username, password, logintoken: loginTokenMatch[1] },
                {
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                        Cookie: this.cookies.join("; "),
                        Host: new URL(loginUrl).host,
                    },
                    maxRedirects: 0,
                },
            );
        } catch (err) {
            if (axios.isAxiosError(err) && err.response) {
                res = err.response;
            }
        }

        if (!res || res.headers["location"] === loginUrl + "?loginredirect=1") {
            const loginErrorMatch = LOGIN_ERROR_MATCH_REGEX.exec(res?.data ?? "");
            if (loginErrorMatch != null && loginErrorMatch?.length > 1) {
                throw new Error("Login failed: " + loginErrorMatch[1]);
            } else throw new Error("Login failed");
        }
    }
}
