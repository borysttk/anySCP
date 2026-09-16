package com.macnev2013.anyscp

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Foreground service that keeps SSH sessions and file transfers alive while
 * anySCP is in the background.
 *
 * Without this, Android freezes the app process shortly after the activity
 * stops (App Standby, then Doze), which silently stalls an in-flight SFTP
 * transfer and drops idle SSH connections. A foreground service with an ongoing
 * notification is the only sanctioned way to keep network work running, and
 * since Android 14 (API 34) it must additionally declare a service type —
 * `dataSync` is the correct one for user-initiated file transfer.
 *
 * The service holds no transfer logic of its own. The transfers run in the Rust
 * Tokio runtime inside the same process; this exists purely to raise the
 * process's importance so the scheduler leaves it alone. It is started when the
 * first transfer is enqueued and stopped when the queue drains, so the
 * notification is only visible while work is genuinely in progress.
 */
class TransferService : android.app.Service() {

    companion object {
        private const val CHANNEL_ID = "anyscp_transfers"
        private const val NOTIFICATION_ID = 1001

        const val EXTRA_TITLE = "title"
        const val EXTRA_TEXT = "text"

        /**
         * Start (or update) the service.
         *
         * Safe to call repeatedly: a second `startForegroundService` on a
         * running service just re-delivers `onStartCommand`, which refreshes
         * the notification text.
         */
        @JvmStatic
        fun start(context: Context, title: String, text: String) {
            val intent = Intent(context, TransferService::class.java).apply {
                putExtra(EXTRA_TITLE, title)
                putExtra(EXTRA_TEXT, text)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        /** Stop the service and dismiss the notification. */
        @JvmStatic
        fun stop(context: Context) {
            context.stopService(Intent(context, TransferService::class.java))
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val title = intent?.getStringExtra(EXTRA_TITLE) ?: "anySCP"
        val text = intent?.getStringExtra(EXTRA_TEXT) ?: "Transfer in progress"

        val notification = buildNotification(title, text)

        // API 34+ requires the type to be restated here and to match the
        // manifest declaration, or the call throws.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        // Do not resurrect the service after the process dies: the Rust-side
        // transfer state would be gone, leaving an orphaned notification.
        return START_NOT_STICKY
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        val channel = NotificationChannel(
            CHANNEL_ID,
            "File transfers",
            // LOW keeps the notification silent — a progress indicator should
            // not buzz the device on every update.
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Shown while anySCP is transferring files in the background"
            setShowBadge(false)
        }

        getSystemService(NotificationManager::class.java)
            ?.createNotificationChannel(channel)
    }

    private fun buildNotification(title: String, text: String): Notification {
        // Tapping the notification returns to the app rather than starting a
        // second activity instance.
        val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pending = launch?.let {
            PendingIntent.getActivity(
                this,
                0,
                it,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        }

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(pending)
            .build()
    }
}
