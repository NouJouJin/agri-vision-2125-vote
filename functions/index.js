// 最新のv2モジュールから必要な関数をインポート
const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const {setGlobalOptions} = require("firebase-functions/v2");
const admin = require("firebase-admin");
const https = require("https");

// Admin SDKを初期化
admin.initializeApp();

// ★★★ あなたのGASウェブアプリURL ★★★
const GAS_WEB_APP_URL = "METAGRI_HIMITSU_WORD_VOTE";


// 全ての関数の実行リージョンを東京に設定
setGlobalOptions({region: "asia-northeast1"});

// 'votes'コレクションにドキュメントが作成されたときにトリガーされるv2関数
exports.recordVoteToSpreadsheet = onDocumentCreated("votes/{userId}", async (event) => {
    
    // イベントデータがなければ処理を終了
    const snap = event.data;
    if (!snap) {
      console.log("イベントにデータが含まれていませんでした。");
      return;
    }
    
    // 投票データを取得
    const voteData = snap.data();
    const userId = event.params.userId;
    const votedFor = voteData.votedFor;

    // --- ★★★ ここからが追加・変更された処理 ★★★ ---

    // 1. "works"コレクションの対応する作品の参照を取得
    const workRef = admin.firestore().collection("works").doc(votedFor);
    
    // 2. 票数を+1する処理を非同期で実行
    const incrementVotePromise = workRef.update({
        votes: admin.firestore.FieldValue.increment(1)
    }).catch(async (error) => {
        // もし作品ドキュメントが存在しなかった場合 (エラーコード5は 'NOT_FOUND')
        if (error.code === 5) {
            console.log(`作品ID: ${votedFor} が存在しなかったので、新規作成します。`);
            // set()でドキュメントを新規作成し、票数を1に設定
            return workRef.set({ votes: 1 });
        }
        // その他のエラーの場合はログに出力
        console.error("票数の更新中にエラーが発生しました:", error);
        // エラーを再スローして、問題があったことを知らせる
        throw error;
    });

    // --- ★★★ ここまで ★★★

    // 3. ユーザー情報を取得し、スプレッドシートに記録する処理
    try {
        const userRecord = await admin.auth().getUser(userId);
      
        const postData = {
          userId: userRecord.uid,
          userName: userRecord.displayName || "名前なし",
          email: userRecord.email,
          votedFor: votedFor,
        };

        const postDataString = JSON.stringify(postData);
        // GASへのリクエスト処理 (変更なし、Promise化)
        const gasRequestPromise = new Promise((resolve, reject) => {
            const url = new URL(GAS_WEB_APP_URL);
            const options = {
                hostname: url.hostname,
                path: url.pathname,
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Content-Length": Buffer.byteLength(postDataString),
                },
            };
            const req = https.request(options, (res) => {
                let responseBody = "";
                res.on("data", (chunk) => { responseBody += chunk; });
                res.on("end", () => {
                    console.log("GASからのレスポンス:", responseBody);
                    resolve(responseBody);
                });
            });
            req.on("error", (e) => reject(e));
            req.write(postDataString);
            req.end();
        });
        
        // 票数更新とGASへのリクエストの両方が完了するのを待つ
        await Promise.all([incrementVotePromise, gasRequestPromise]);
        
        console.log(`ユーザーID: ${userId} の投票処理が正常に完了しました。`);

    } catch (error) {
      console.error("関数全体の処理中にエラーが発生しました:", error);
    }
});