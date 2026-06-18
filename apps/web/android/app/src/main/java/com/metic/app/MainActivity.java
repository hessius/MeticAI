package com.metic.app;

import android.os.Bundle;

import androidx.activity.EdgeToEdge;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Draw under the system bars; @capacitor-community/safe-area feeds the
        // real insets into env(safe-area-inset-*) so CSS handles the padding.
        EdgeToEdge.enable(this);
    }
}
