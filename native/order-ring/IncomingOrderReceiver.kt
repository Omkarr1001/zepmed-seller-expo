package com.zepmed.seller

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class IncomingOrderReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val orderId = intent.getIntExtra(IncomingOrderNotifier.EXTRA_ORDER, 0)
    if (intent.action == IncomingOrderNotifier.ACTION_SILENCE) {
      IncomingOrderNotifier.mute(context, orderId)
      IncomingOrderNotifier.dismiss(context)
      return
    }
    IncomingOrderNotifier.dismiss(context)
    if (orderId > 0) context.startActivity(IncomingOrderNotifier.openIntent(context, orderId))
  }
}
