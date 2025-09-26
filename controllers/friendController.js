// controllers/friendController.js
const pool = require('../config/db');

// POST /api/friends/by-code
// body: { code: "ABC1234" }
exports.addFriendByCode = async (req, res) => {
  try {
    const myId = req.user?.id;
    if (!myId) return res.status(401).json({ success:false, message:'인증 필요' });

    let code = (req.body?.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{7}$/.test(code)) {
      return res.status(400).json({ success:false, message:'코드 형식이 올바르지 않습니다.' });
    }

    // 상대 찾기
    const t = await pool.query(
      `SELECT id, name, avatar_name, point, friend_code
         FROM users
        WHERE friend_code = $1
        LIMIT 1`,
      [code]
    );
    if (t.rowCount === 0) {
      return res.status(404).json({ success:false, message:'해당 코드의 사용자가 없습니다.' });
    }

    const other = t.rows[0];
    if (other.id === myId) {
      return res.status(400).json({ success:false, message:'본인 코드는 추가할 수 없습니다.' });
    }

    // 친구 관계 업서트 (무조건 ACCEPTED로)
       // 항상 '작은 id, 큰 id' 순서로 저장 (무향 관계 한 행만 유지)
    const a = Math.min(myId, other.id);
    const b = Math.max(myId, other.id);
    const upsertSql = `
      INSERT INTO public.friend_edges (requester_id, addressee_id, status, accepted_at)
      VALUES ($1, $2, 'ACCEPTED', now())
      ON CONFLICT (requester_id, addressee_id)
      DO UPDATE SET status = 'ACCEPTED', accepted_at = now()
      RETURNING id, requester_id, addressee_id, status, accepted_at, updated_at
    `;
    const r = await pool.query(upsertSql, [a, b]);
    

    return res.json({
      success: true,
      message: '친구가 추가되었습니다.',
      result: {
        friend: {
          id: other.id,
          name: other.name,
          avatarName: other.avatar_name,
          point: other.point,
          friendCode: other.friend_code
        },
        edge: r.rows[0]
      }
    });
  } catch (e) {
    console.error('addFriendByCode error:', e);
    return res.status(500).json({ success:false, message:'친구 추가 실패' });
  }
};

// GET /api/friends/ranking?limit=50
exports.getFriendsRanking = async (req, res) => {
  try {
    const myId = req.user?.id;
    if (!myId) return res.status(401).json({ success:false, message:'인증 필요' });

    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);

    // 나와 친구(ACCEPTED)인 사용자만 추려서 포인트 내림차순
    const q = `
      SELECT u.id, u.name, u.avatar_name, u.point
        FROM public.friend_edges fe
        JOIN public.users u
          ON u.id = CASE
                      WHEN fe.requester_id = $1 THEN fe.addressee_id
                      ELSE fe.requester_id
                    END
       WHERE fe.status = 'ACCEPTED'
         AND ($1 = fe.requester_id OR $1 = fe.addressee_id)
       ORDER BY u.point DESC, u.id ASC
       LIMIT $2
    `;
    const { rows } = await pool.query(q, [myId, limit]);

    return res.json({
      success: true,
      result: {
        meId: myId,       // 프론트에서 isMe 판단용
        items: rows.map(r => ({
          id: r.id,
          name: r.name,
          avatarName: r.avatar_name,
          point: r.point
        }))
      }
    });
  } catch (e) {
    console.error('getFriendsRanking error:', e);
    return res.status(500).json({ success:false, message:'랭킹 조회 실패' });
  }
};

// GET /api/friends/ranking/all?limit=50
exports.getGlobalRanking = async (req, res) => {
  try {
    const myId = req.user?.id;
    if (!myId) return res.status(401).json({ success:false, message:'인증 필요' });

    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);

    const q = `
      SELECT id, name, avatar_name, point
        FROM public.users
       ORDER BY point DESC, id ASC
       LIMIT $1
    `;
    const { rows } = await pool.query(q, [limit]);

    return res.json({
      success: true,
      result: {
        meId: myId,  // 프론트 isMe 판단용
        items: rows.map(r => ({
          id: r.id,
          name: r.name,
          avatarName: r.avatar_name,
          point: r.point
        }))
      }
    });
  } catch (e) {
    console.error('getGlobalRanking error:', e);
    return res.status(500).json({ success:false, message:'전체 랭킹 조회 실패' });
  }
};