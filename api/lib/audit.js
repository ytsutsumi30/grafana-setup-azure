const logger = require('./logger');

function getRequestUser(req) {
  const user = req?.user || req?.m365User || null;
  if (!user) {
    return {
      user_id: null,
      user_email: null,
      user_name: null
    };
  }
  return {
    user_id: user.id || user.sub || null,
    user_email: user.mail || user.userPrincipalName || user.email || null,
    user_name: user.displayName || user.name || null
  };
}

async function recordAuditEvent(clientOrPool, req, event) {
  try {
    const user = getRequestUser(req);
    await clientOrPool.query(`
      INSERT INTO shipping_audit_events (
        shipping_instruction_id,
        line_id,
        allocation_id,
        event_type,
        event_status,
        product_id,
        lot_id,
        lot_number,
        qr_code,
        quantity,
        before_data,
        after_data,
        reason_code,
        comment,
        user_id,
        user_email,
        user_name,
        occurred_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11::jsonb,$12::jsonb,$13,$14,$15,$16,$17,
        COALESCE($18::timestamp, CURRENT_TIMESTAMP)
      )
    `, [
      event.shipping_instruction_id || null,
      event.line_id || null,
      event.allocation_id || null,
      event.event_type,
      event.event_status || 'success',
      event.product_id || null,
      event.lot_id || null,
      event.lot_number || null,
      event.qr_code || null,
      event.quantity ?? null,
      event.before_data === undefined ? null : JSON.stringify(event.before_data),
      event.after_data === undefined ? null : JSON.stringify(event.after_data),
      event.reason_code || null,
      event.comment || null,
      user.user_id,
      user.user_email,
      user.user_name,
      event.occurred_at || null
    ]);
  } catch (error) {
    logger.warn('Failed to record shipping audit event', {
      event_type: event?.event_type,
      shipping_instruction_id: event?.shipping_instruction_id,
      error: error.message
    });
  }
}

module.exports = {
  recordAuditEvent
};
