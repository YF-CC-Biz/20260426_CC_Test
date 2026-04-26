# freee 人事労務 MCP Server

[freee 人事労務](https://www.freee.co.jp/hr/) の公開 API を [Model Context Protocol](https://modelcontextprotocol.io) サーバとして公開する実装です。Claude Code / Claude Desktop などの MCP クライアントから、自然言語で freee 人事労務の従業員情報・勤怠・打刻・給与を操作できるようになります。

## 提供ツール

| ツール名 | 概要 | エンドポイント |
| --- | --- | --- |
| `freee_hr_get_me` | ログインユーザー情報 (company_id / employee_id) を取得 | `GET /users/me` |
| `freee_hr_list_companies` | 所属事業所一覧 | `GET /companies` |
| `freee_hr_list_employees` | 従業員一覧 (年月指定) | `GET /employees` |
| `freee_hr_get_employee` | 従業員詳細 | `GET /employees/{id}` |
| `freee_hr_get_time_clocks` | 打刻履歴の取得 | `GET /employees/{id}/time_clocks` |
| `freee_hr_get_available_time_clock_types` | 打刻可能種別の取得 | `GET /employees/{id}/time_clocks/available_types` |
| `freee_hr_punch_time_clock` | 出勤・退勤・休憩開始/終了の打刻 | `POST /employees/{id}/time_clocks` |
| `freee_hr_get_work_record` | 日次勤怠の取得 | `GET /employees/{id}/work_records/{date}` |
| `freee_hr_update_work_record` | 日次勤怠の作成・更新 | `PUT /employees/{id}/work_records/{date}` |
| `freee_hr_delete_work_record` | 日次勤怠の削除 | `DELETE /employees/{id}/work_records/{date}` |
| `freee_hr_get_work_record_summary` | 月次勤怠サマリの取得 | `GET /employees/{id}/work_record_summaries/{year}/{month}` |
| `freee_hr_update_work_record_summary` | 月次勤怠サマリの更新 | `PUT /employees/{id}/work_record_summaries/{year}/{month}` |
| `freee_hr_list_payrolls` | 給与情報の取得 | `GET /salaries/payrolls` |
| `freee_hr_request` | 任意エンドポイントへの汎用呼び出し (エスケープハッチ) | 任意 |

すべて `https://api.freee.co.jp/hr/api/v1` を基底 URL として呼び出します。

## セットアップ

### 1. アクセストークンの取得と保管

1. [freee Developers Community](https://developer.freee.co.jp) でアプリを登録
2. OAuth2 で `hr` スコープを許可してアクセストークンを発行
3. **`.env` ファイルに保管します。**MCP クライアントの設定ファイル (`settings.json` 等) や `git` 管理対象には**絶対に直書きしない**でください。

```bash
cp .env.example .env
# エディタで .env を開き、FREEE_ACCESS_TOKEN= の右に貼り付け
chmod 600 .env   # 推奨: 自分以外から読めないように
```

`.env` は `.gitignore` 済みなのでコミットされません。サーバ起動時に自動で読み込まれ、`process.env` に既に値があればそちらを優先します (CI などでシークレットマネージャから注入する場合に上書きされません)。

> 短命トークンを利用する場合はリフレッシュ運用を別途用意してください。本サーバはトークンを `.env` または環境変数からそのまま使います。

### 2. ビルド

```bash
npm install
npm run build
```

### 3. MCP クライアントへの登録

Claude Code の場合 (`~/.claude/settings.json` または `.mcp.json`)。**`env` ブロックにトークンを書かず**、`cwd` でこのリポジトリを指して `.env` を読ませます:

```json
{
  "mcpServers": {
    "freee-hr": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/absolute/path/to/this/repo"
    }
  }
}
```

`.env` の場所をリポジトリ外に置きたい場合は `FREEE_HR_ENV_FILE` で明示できます (それ自体は機微情報ではないので設定ファイルに書いて構いません):

```json
{
  "mcpServers": {
    "freee-hr": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"],
      "env": {
        "FREEE_HR_ENV_FILE": "/home/me/.config/freee-hr/.env"
      }
    }
  }
}
```

Claude Desktop の `claude_desktop_config.json` でも同じ形式です。シークレットを JSON に書かないこと、それだけ守れば OS のシークレットストアやパスワードマネージャと組み合わせる運用にも移行しやすくなります。

## 使い方の例

```
> 今月の自分の勤怠サマリを教えて
> 山田太郎さんの 2026-04-15 の勤怠を 9:00-18:00 (休憩 12:00-13:00) に修正して
> 今出勤打刻して
```

LLM はツール定義から `company_id` / `employee_id` の必要性を認識します。`FREEE_COMPANY_ID` を設定しておくと毎回指定する必要がなくなります。

## 開発

```bash
npm run dev      # tsc --watch
npm run typecheck
```

## ライセンス

MIT
