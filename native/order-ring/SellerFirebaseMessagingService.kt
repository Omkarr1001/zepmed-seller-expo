package com.zepmed.seller

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.delegates.FirebaseMessagingDelegate

class SellerFirebaseMessagingService : FirebaseMessagingService() {
  private val expo by lazy { FirebaseMessagingDelegate(this) }

  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    val data = remoteMessage.data
    val action = data["action"].orEmpty()
    val channel = data["android_channel_id"].orEmpty()
    if (action == "new_order" || channel == IncomingOrderNotifier.CHANNEL) {
      val orderId = (data["order_id"] ?: data["orderId"] ?: "0").toIntOrNull() ?: 0
      if (!IncomingOrderNotifier.isLoggedIn(this) || !IncomingOrderNotifier.soundEnabled(this)) {
        IncomingOrderNotifier.dismiss(this)
        return
      }
      val title = data["title"]?.takeIf { it.isNotBlank() }
        ?: remoteMessage.notification?.title
        ?: "New order"
      val body = data["message"]?.takeIf { it.isNotBlank() }
        ?: remoteMessage.notification?.body
        ?: "Open the seller app to accept"
      if (IncomingOrderNotifier.appActive) {
        SellerOrderRingModule.emit(orderId, title, body)
        return
      }
      IncomingOrderNotifier.show(this, orderId, title, body)
      return
    }
    expo.onMessageReceived(remoteMessage)
  }

  override fun onNewToken(token: String) {
    expo.onNewToken(token)
  }

  override fun onDeletedMessages() {
    expo.onDeletedMessages()
  }
}
