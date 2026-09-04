package com.focusflow.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/**
 * Home screen widget for "2-minute mode": tapping it launches the app
 * straight into a short, 5-card study session. See QuickStartPlugin.java
 * and js/core/quick-start.js for the JS hand-off.
 */
public class TwoMinuteWidgetProvider extends AppWidgetProvider {

    public static final String EXTRA_QUICK_START = "com.focusflow.app.EXTRA_QUICK_START";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_two_minute);

            Intent launchIntent = new Intent(context, MainActivity.class);
            launchIntent.setAction(Intent.ACTION_MAIN);
            launchIntent.addCategory(Intent.CATEGORY_LAUNCHER);
            launchIntent.setFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK
                    | Intent.FLAG_ACTIVITY_CLEAR_TOP
                    | Intent.FLAG_ACTIVITY_SINGLE_TOP
            );
            launchIntent.putExtra(EXTRA_QUICK_START, true);

            PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                appWidgetId,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            views.setOnClickPendingIntent(R.id.widget_root, pendingIntent);
            appWidgetManager.updateAppWidget(appWidgetId, views);
        }
    }
}
