package com.focusflow.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

/**
 * Home-screen status widget: daily goal progress, due cards, and streak.
 * Numbers are pushed from JS via WidgetDataPlugin into SharedPreferences;
 * this provider only paints RemoteViews from that cache.
 */
public class StatusWidgetProvider extends AppWidgetProvider {

    public static final String PREFS_NAME = "focusflow_widget_stats";
    public static final String KEY_GOAL_TEXT = "goal_text";
    public static final String KEY_DUE_TEXT = "due_text";
    public static final String KEY_STREAK_TEXT = "streak_text";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateOne(context, appWidgetManager, appWidgetId);
        }
    }

    static void updateOne(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_status);

        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String goal = prefs.getString(KEY_GOAL_TEXT, "۰ / ۲۰");
        String due = prefs.getString(KEY_DUE_TEXT, "۰");
        String streak = prefs.getString(KEY_STREAK_TEXT, "۰");

        views.setTextViewText(R.id.widget_status_goal, goal);
        views.setTextViewText(R.id.widget_status_due, due);
        views.setTextViewText(R.id.widget_status_streak, streak);

        Intent launchIntent = new Intent(context, MainActivity.class);
        launchIntent.setAction(Intent.ACTION_MAIN);
        launchIntent.addCategory(Intent.CATEGORY_LAUNCHER);
        launchIntent.setFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP
        );

        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            appWidgetId + 9000,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_status_root, pendingIntent);

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    /** Called from WidgetDataPlugin after JS writes new stats. */
    public static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, StatusWidgetProvider.class));
        if (ids == null || ids.length == 0) return;
        for (int id : ids) {
            updateOne(context, manager, id);
        }
    }
}
