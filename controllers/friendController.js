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
    const upsertSql = `
      INSERT INTO public.friend_edges (requester_id, addressee_id, status, accepted_at)
      VALUES ($1, $2, 'ACCEPTED', now())
      ON CONFLICT ON CONSTRAINT friend_edges_pair_uniq
      DO UPDATE SET status = 'ACCEPTED', accepted_at = now()
      RETURNING id, requester_id, addressee_id, status, accepted_at, updated_at
    `;
    const r = await pool.query(upsertSql, [myId, other.id]);

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